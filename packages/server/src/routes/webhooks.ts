import { randomBytes } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import {
  WEBHOOK_EVENTS,
  type WebhookCreatedResponse,
  type WebhooksResponse,
} from "@manifesto/shared";
import { Hono } from "hono";
import { audit } from "#/audit/audit.ts";
import { requireConfirmation } from "#/auth/confirmation.ts";
import type { LoginAttempts } from "#/auth/local/loginAttempts.ts";
import { nowIso } from "#/lib/time.ts";
import { newId } from "#/lib/ulid.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { listedWebhook } from "#/storage/webhookMapping.ts";
import {
  webhookCreateSchema,
  webhookUpdateSchema,
} from "#/validation/accessSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";
import type { WebhookDispatcher } from "#/webhooks/dispatcher.ts";

interface WebhookDeps {
  storage: StorageDriver;
  dispatcher: WebhookDispatcher;
  loginAttempts: LoginAttempts;
}

export const MAX_WEBHOOKS_PER_USER = 10;

/**
 * `/api/v1/webhooks`: where the server sends the note events of a user.
 * Session-only, as for API tokens. A webhook sends each note of its owner to a
 * URL. A token that a script has must not be able to set that up.
 */
export function createWebhookRoutes(deps: WebhookDeps) {
  const routes = new Hono<{ Variables: { auth: AuthContext } }>();
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
      const { url, events, password } = c.req.valid("json");
      // From now, each note goes to this address.
      await requireConfirmation(deps, c.get("auth"), password);
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
      audit(deps.storage, c, {
        action: "webhook.created",
        actorId: userId,
        detail: { url },
      });
      const body: WebhookCreatedResponse = {
        webhook: listedWebhook(webhook),
        secret,
      };
      return c.json(body, 201);
    },
  );

  /**
   * Turns one on again after failures switched it off, or turns it off
   * manually.
   */
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
    const webhook = await owned(c.req.param("id"), userId);
    if (!(await deps.storage.webhooks.delete(webhook.id, userId))) {
      throw new HttpError(404, "Webhook not found");
    }
    audit(deps.storage, c, {
      action: "webhook.deleted",
      actorId: userId,
      detail: { url: webhook.url },
    });
    return c.body(null, 204);
  });

  /** Sends a `ping` now, and answers with the response. */
  routes.post("/:id/test", async (c) => {
    const { userId } = c.get("auth");
    const webhook = await owned(c.req.param("id"), userId);
    const result = await deps.dispatcher.ping(webhook);
    return c.json(result);
  });

  return routes;
}
