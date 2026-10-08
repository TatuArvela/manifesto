import type { ServerConfig } from "../config.js";
import { logger } from "../lib/logger.js";
import { countMetric } from "../lib/metrics.js";
import { nowIso } from "../lib/time.js";
import { FetchRefused, safeFetch } from "../linkPreview/safeFetch.js";
import type {
  StorageDriver,
  StoredPushSubscription,
} from "../storage/types.js";
import {
  encryptPayload,
  generateVapidKeys,
  type VapidKeys,
  vapidAuthorization,
} from "./webPush.js";

/** Sends that may fail in a row before a subscription is dropped. */
export const PUSH_DROP_AFTER = 10;
/** How long a push service keeps a message for a device that is off. A
 * reminder an hour late is not worth delivering, as on the client. */
const TTL_SECONDS = 60 * 60;
const SECRET_NAME = "vapid";

export type PushOutcome = "sent" | "gone" | "failed";

export interface PushSender {
  /** The key browsers subscribe with, made on first use and kept. */
  publicKey(): Promise<string>;
  /**
   * Sends one message to one subscription. A subscription the push service
   * no longer knows is deleted, and one that keeps failing is too.
   */
  send(
    subscription: StoredPushSubscription,
    message: object,
  ): Promise<PushOutcome>;
}

/**
 * Who a push service should contact about this server's messages (the `sub`
 * of RFC 8292): the client's public address, when the server knows one over
 * `https`. The RFC allows only that or a `mailto:`, and Apple refuses the
 * whole message for anything else, so an `http` address (a server on the
 * local network, or in development) is passed over. Without one there is
 * only a placeholder to give, which the large push services accept.
 */
export function subjectOf(
  cfg: Pick<ServerConfig, "appUrl" | "corsOrigins">,
): string {
  const origin = [cfg.appUrl, ...cfg.corsOrigins].find((o) =>
    o?.startsWith("https://"),
  );
  return origin ?? "mailto:webpush@manifesto.invalid";
}

export function createPushSender(deps: {
  storage: StorageDriver;
  cfg: Pick<ServerConfig, "appUrl" | "corsOrigins">;
  /** Test seam. Production reaches public addresses only. */
  isAllowedAddress?: ((address: string) => boolean) | undefined;
  /** Test seam. Production accepts only the scheme's default port. */
  allowAnyPort?: boolean | undefined;
}): PushSender {
  const { storage } = deps;
  let keys: Promise<VapidKeys> | null = null;

  /** The server's push key: read, or made and stored the first time. Made in
   * the database rather than at boot so two processes agree on one. */
  const vapidKeys = () => {
    keys ??= (async () => {
      const held = await storage.serverSecrets.setIfAbsent(
        SECRET_NAME,
        JSON.stringify(generateVapidKeys()),
        nowIso(),
      );
      return JSON.parse(held) as VapidKeys;
    })().catch((err) => {
      // Not held as a failure: the next call tries again.
      keys = null;
      throw err;
    });
    return keys;
  };

  return {
    async publicKey() {
      return (await vapidKeys()).publicKey;
    },

    async send(subscription, message) {
      let status: number | null = null;
      try {
        const vapid = await vapidKeys();
        // The endpoint is whatever the browser reported, so it goes through
        // the same boundary as a webhook or a link preview.
        await safeFetch(new URL(subscription.endpoint), {
          method: "POST",
          body: encryptPayload(
            Buffer.from(JSON.stringify(message)),
            subscription,
          ),
          headers: {
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: String(TTL_SECONDS),
            Urgency: "high",
            Authorization: vapidAuthorization(
              subscription.endpoint,
              vapid,
              subjectOf(deps.cfg),
            ),
          },
          accept: "*/*",
          maxBytes: 16 * 1024,
          overflow: "truncate",
          timeoutMs: 10_000,
          acceptStatus: (code) => code >= 200 && code < 300,
          ...(deps.isAllowedAddress && {
            isAllowedAddress: deps.isAllowedAddress,
          }),
          ...(deps.allowAnyPort && { allowAnyPort: true }),
        });
      } catch (err) {
        status = err instanceof FetchRefused ? (err.status ?? null) : null;
        // The push service says the browser unsubscribed, or was uninstalled.
        if (status === 404 || status === 410) {
          await storage.pushSubscriptions.delete(subscription.id);
          countMetric("manifesto_push_messages_total", PUSH_HELP, {
            outcome: "gone",
          });
          return "gone";
        }
        const failures = await storage.pushSubscriptions.recordFailure(
          subscription.id,
        );
        if (failures >= PUSH_DROP_AFTER) {
          await storage.pushSubscriptions.delete(subscription.id);
        }
        logger.warn("Push message was not delivered", {
          status,
          error: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
        countMetric("manifesto_push_messages_total", PUSH_HELP, {
          outcome: "failed",
        });
        return "failed";
      }
      await storage.pushSubscriptions.recordSuccess(subscription.id);
      countMetric("manifesto_push_messages_total", PUSH_HELP, {
        outcome: "sent",
      });
      return "sent";
    },
  };
}

const PUSH_HELP = "Web Push messages, by whether the push service took them.";
