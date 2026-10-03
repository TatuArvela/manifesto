import { zValidator } from "@hono/zod-validator";
import {
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  type PushKeyResponse,
} from "@manifesto/shared";
import { Hono } from "hono";
import { nowIso } from "../lib/time.js";
import { hashToken } from "../lib/token.js";
import { newId } from "../lib/ulid.js";
import type { AuthContext } from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { PushSender } from "../push/sender.js";
import { isUsableTarget } from "../push/webPush.js";
import type { StorageDriver } from "../storage/types.js";
import {
  pushSubscribeSchema,
  pushUnsubscribeSchema,
} from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";

/**
 * `/api/push`: a browser subscribing to this account's reminders as push
 * messages. Session-only, like everything that decides where an account's
 * notes are sent: a subscription receives the title and first words of every
 * note whose reminder comes due.
 *
 * The browser asks for the server's key, subscribes with it at its own push
 * service, and hands the subscription over. One is a browser profile; signing
 * out there, or the push service reporting it gone, removes it, and so does
 * the end of the session it was made in, however that comes about.
 */
export function createPushRoutes(deps: {
  storage: StorageDriver;
  sender: PushSender;
}) {
  const { storage, sender } = deps;
  const routes = new Hono<{ Variables: { auth: AuthContext } }>();

  routes.get("/key", async (c) => {
    const body: PushKeyResponse = { publicKey: await sender.publicKey() };
    return c.json(body);
  });

  routes.post(
    "/subscriptions",
    zValidator("json", pushSubscribeSchema, validatorHook),
    async (c) => {
      const { userId, token } = c.get("auth");
      const { endpoint, keys } = c.req.valid("json");
      if (!isUsableTarget(keys)) {
        throw new HttpError(422, "keys: Not a push subscription's keys");
      }
      await storage.pushSubscriptions.save({
        id: newId(),
        userId,
        // Bound to this session, so it ends when the session does.
        sessionToken: hashToken(token),
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        createdAt: nowIso(),
        failureCount: 0,
      });
      // The newest are kept: a browser that subscribed long ago and was
      // never heard of again is the one to let go.
      const held = await storage.pushSubscriptions.listByUser(userId);
      for (const old of held.slice(
        0,
        Math.max(0, held.length - MAX_PUSH_SUBSCRIPTIONS_PER_USER),
      )) {
        await storage.pushSubscriptions.delete(old.id);
      }
      return c.body(null, 204);
    },
  );

  routes.delete(
    "/subscriptions",
    zValidator("json", pushUnsubscribeSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      await storage.pushSubscriptions.deleteByEndpoint(
        c.req.valid("json").endpoint,
        userId,
      );
      return c.body(null, 204);
    },
  );

  return routes;
}
