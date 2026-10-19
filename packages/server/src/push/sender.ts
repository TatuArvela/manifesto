import type { ServerConfig } from "#/config.ts";
import { logger } from "#/lib/logger.ts";
import { countMetric } from "#/lib/metrics.ts";
import { nowIso } from "#/lib/time.ts";
import { FetchRefused, safeFetch } from "#/linkPreview/safeFetch.ts";
import type { StorageDriver, StoredPushSubscription } from "#/storage/types.ts";
import {
  encryptPayload,
  generateVapidKeys,
  type VapidKeys,
  vapidAuthorization,
} from "./webPush.ts";

/**
 * The number of sends that can fail in sequence before the server drops a
 * subscription.
 */
export const PUSH_DROP_AFTER = 10;
/**
 * How long a push service keeps a message for a device that is off. A reminder
 * that is one hour late is not worth a delivery, as on the client.
 */
const TTL_SECONDS = 60 * 60;
const SECRET_NAME = "vapid";

export type PushOutcome = "sent" | "gone" | "failed";

export interface PushSender {
  /** The key with which browsers subscribe, made on the first use and kept. */
  publicKey(): Promise<string>;
  /**
   * Sends one message to one subscription. The code deletes a subscription that
   * the push service does not know now, and also a subscription that continues
   * to fail.
   */
  send(
    subscription: StoredPushSubscription,
    message: object,
  ): Promise<PushOutcome>;
}

/**
 * Whom a push service must contact about the messages of this server (the `sub`
 * of RFC 8292): the public address of the client, when the server knows one
 * over `https`. The RFC permits only that or a `mailto:`. Apple refuses the
 * full message for all other values. Thus, the code skips an `http` address (a
 * server on the local network, or in development). Without one, it can give
 * only a placeholder, which the large push services accept.
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
  /** Test seam. Production reaches only public addresses. */
  isAllowedAddress?: ((address: string) => boolean) | undefined;
  /** Test seam. Production accepts only the default port of the scheme. */
  allowAnyPort?: boolean | undefined;
}): PushSender {
  const { storage } = deps;
  let keys: Promise<VapidKeys> | null = null;

  /**
   * The push key of the server: read, or made and stored the first time. It is
   * made in the database, not at start. Thus, two processes agree on one.
   */
  const vapidKeys = () => {
    keys ??= (async () => {
      const held = await storage.serverSecrets.setIfAbsent(
        SECRET_NAME,
        JSON.stringify(generateVapidKeys()),
        nowIso(),
      );
      return JSON.parse(held) as VapidKeys;
    })().catch((err) => {
      // Not kept as a failure. The next call tries again.
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
        // The browser reported the endpoint. Thus, it goes through the same
        // boundary as a webhook or a link preview.
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
        // The push service says that the browser unsubscribed, or was
        // uninstalled.
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
