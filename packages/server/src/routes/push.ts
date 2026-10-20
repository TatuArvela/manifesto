import { zValidator } from "@hono/zod-validator";
import {
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  type PushKeyResponse,
} from "@manifesto/shared";
import { Hono } from "hono";
import { audit } from "#/audit/audit.ts";
import { nowIso } from "#/lib/time.ts";
import { hashToken } from "#/lib/token.ts";
import { newId } from "#/lib/ulid.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { PushSender } from "#/push/sender.ts";
import { isUsableTarget } from "#/push/webPush.ts";
import type { StorageDriver } from "#/storage/types.ts";
import {
  pushSubscribeSchema,
  pushUnsubscribeSchema,
} from "#/validation/accountSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";

/**
 * `/api/v1/push`: a browser that subscribes to the reminders of this account as
 * push messages. Session-only, as all actions that decide where the notes of an
 * account go: a subscription gets the title and the first words of each note
 * whose reminder becomes due.
 *
 * The browser asks for the key of the server, subscribes with it at its own
 * push service, and gives the subscription to the server. One subscription is
 * one browser profile. A sign-out there, or a report from the push service that
 * it is gone, removes it. The end of the session in which it was made also
 * removes it, whatever the cause.
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
      // A browser renews its subscription at each start. Only a subscription
      // that the account did not have is a new place for its reminders.
      const known = (await storage.pushSubscriptions.listByUser(userId)).some(
        (held) => held.endpoint === endpoint,
      );
      await storage.pushSubscriptions.save({
        id: newId(),
        userId,
        // Bound to this session. Thus, it ends when the session ends.
        sessionToken: hashToken(token),
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        createdAt: nowIso(),
        failureCount: 0,
      });
      if (!known) {
        audit(storage, c, {
          action: "push.subscribed",
          actorId: userId,
          // The push service, not the endpoint. Its path lets a sender reach
          // the browser.
          detail: { service: new URL(endpoint).host },
        });
      }
      // The newest are kept. A browser that subscribed long ago and was never
      // heard from again is the one to remove.
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
