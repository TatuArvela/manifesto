import { randomBytes } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import {
  WEBHOOK_EVENTS,
  type WebhookCreatedResponse,
  type WebhooksResponse,
} from "@manifesto/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AuthProvider } from "../auth/types.js";
import { nowIso } from "../lib/time.js";
import { newId } from "../lib/ulid.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";
import { listedWebhook } from "../storage/webhookMapping.js";
import {
  webhookCreateSchema,
  webhookUpdateSchema,
} from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";
import type { WebhookDispatcher } from "../webhooks/dispatcher.js";

interface WebhookDeps {
  storage: StorageDriver;
  authProvider: AuthProvider;
  /** Null when the server has webhooks off: every route then answers 404. */
  dispatcher: WebhookDispatcher | null;
  rateLimit?: MiddlewareHandler;
}

export const MAX_WEBHOOKS_PER_USER = 10;

/**
 * `/api/webhooks`: where a user's note events are posted. Session-only like
 * API tokens: a webhook sends every note its owner holds to a URL, which is
 * not something a token handed to a script should be able to set up.
 */
export function createWebhookRoutes(deps: WebhookDeps) {
  const routes = new Hono<{ Variables: { auth: AuthContext } }>();
  routes.use("*", async (_c, next) => {
    if (!deps.dispatcher) {
      throw new HttpError(404, "Webhooks are not enabled on this server");
    }
    await next();
  });
  routes.use(
    "*",
    createAuthMiddleware(deps.authProvider, { sessionOnly: true }),
  );
  if (deps.rateLimit) routes.use("*", deps.rateLimit);

  const owned = async (id: string, userId: string) => {
    const webhook = await deps.storage.webhooks.get(id, userId);
    if (!webhook) throw new HttpError(404, "Webhook not found");
    return webhook;
  };

  routes.get("/", async (c) => {
    const { userId } = c.get("auth");
    const body: WebhooksResponse = {
      webhooks: (await deps.storage.webhooks.listByUser(userId)).map(
        listedWebhook,
      ),
    };
    return c.json(body);
  });

  routes.post(
    "/",
    zValidator("json", webhookCreateSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const { url, events } = c.req.valid("json");
      const existing = await deps.storage.webhooks.listByUser(userId);
      if (existing.length >= MAX_WEBHOOKS_PER_USER) {
        throw new HttpError(409, "Remove a webhook before adding another");
      }
      const secret = `whsec_${randomBytes(24).toString("base64url")}`;
      const webhook = {
        id: newId(),
        userId,
        url,
        secret,
        events: events ?? [...WEBHOOK_EVENTS],
        active: true,
        createdAt: nowIso(),
        lastDeliveryAt: null,
        lastStatus: null,
        lastError: null,
        failureCount: 0,
      };
      await deps.storage.webhooks.create(webhook);
      const body: WebhookCreatedResponse = {
        webhook: listedWebhook(webhook),
        secret,
      };
      return c.json(body, 201);
    },
  );

  /** Turns one on again after failures switched it off, or off by hand. */
  routes.put(
    "/:id",
    zValidator("json", webhookUpdateSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const id = c.req.param("id");
      await owned(id, userId);
      await deps.storage.webhooks.setActive(
        id,
        userId,
        c.req.valid("json").active,
      );
      return c.json({ webhook: listedWebhook(await owned(id, userId)) });
    },
  );

  routes.delete("/:id", async (c) => {
    const { userId } = c.get("auth");
    if (!(await deps.storage.webhooks.delete(c.req.param("id"), userId))) {
      throw new HttpError(404, "Webhook not found");
    }
    return c.body(null, 204);
  });

  /** Sends a `ping` now and answers with what came back. */
  routes.post("/:id/test", async (c) => {
    const { userId } = c.get("auth");
    const webhook = await owned(c.req.param("id"), userId);
    const result = await (deps.dispatcher as WebhookDispatcher).ping(webhook);
    return c.json(result);
  });

  return routes;
}
