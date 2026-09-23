import { createHmac } from "node:crypto";
import type {
  WebhookEventName,
  WebhookPayload,
  WebSocketEvent,
} from "@manifesto/shared";
import type { WebhookMode } from "../config.js";
import { logger } from "../lib/logger.js";
import { countMetric } from "../lib/metrics.js";
import { nowIso } from "../lib/time.js";
import { newId } from "../lib/ulid.js";
import {
  isLocalNetworkAddress,
  isPublicAddress,
} from "../linkPreview/addressPolicy.js";
import {
  FetchRefused,
  type SafeFetchOptions,
  safeFetch,
} from "../linkPreview/safeFetch.js";
import type { StorageDriver, StoredWebhook } from "../storage/types.js";
import type { Broadcaster } from "../ws/broadcaster.js";

/** Failures in a row that switch a webhook off. */
export const WEBHOOK_DISABLE_AFTER = 20;
/** Attempts per delivery, and the waits between them. */
const RETRY_DELAYS_MS = [0, 5_000, 30_000];
const TIMEOUT_MS = 10_000;
const USER_AGENT =
  "ManifestoWebhook/1.0 (+https://github.com/TatuArvela/manifesto)";

/**
 * Posts a user's note events to their webhooks.
 *
 * It listens to the broadcaster, which is already where every change to a
 * note is announced to each person holding it, as their own copy. So a
 * webhook hears exactly what its owner's open tabs hear: their own notes, and
 * notes shared with them, with their personal fields.
 *
 * Deliveries go through `safeFetch`, the link previews' SSRF boundary: every
 * resolved address is checked and the connection pinned to it, redirects are
 * not followed, and by default only public addresses are reached. An operator
 * running automation beside the server opts in to its network with
 * `WEBHOOKS=private`.
 *
 * Each webhook's deliveries run one at a time, in order, so a receiver sees a
 * note's events in the order they happened. A failed delivery is retried
 * twice; `WEBHOOK_DISABLE_AFTER` failures in a row switch the webhook off
 * until its owner turns it on again.
 */
export interface WebhookDispatcher {
  /** Sends one event now (the "send test" button), and says how it went. */
  ping(
    webhook: StoredWebhook,
  ): Promise<{ status: number | null; error: string | null }>;
  /** Resolves once every queued delivery has finished. For tests. */
  idle(): Promise<void>;
  stop(): void;
}

export interface WebhookDispatcherDeps {
  storage: StorageDriver;
  broadcaster: Broadcaster;
  mode: Exclude<WebhookMode, "off">;
  /** Test seam: the address rule, which production takes from `mode`. */
  isAllowedAddress?: (address: string) => boolean;
  /** Test seam: shortens the waits between attempts. */
  retryDelaysMs?: number[];
}

function eventName(event: WebSocketEvent): WebhookEventName | null {
  switch (event.type) {
    case "note:created":
      return "note.created";
    case "note:updated":
      return "note.updated";
    case "note:deleted":
      return "note.deleted";
    default:
      return null;
  }
}

function payloadFor(
  event: WebSocketEvent,
  name: WebhookEventName,
): WebhookPayload | null {
  const base = { deliveryId: newId(), occurredAt: nowIso() };
  if (event.type === "note:deleted") {
    return { ...base, event: "note.deleted", noteId: event.id };
  }
  if (event.type === "note:created" || event.type === "note:updated") {
    return {
      ...base,
      event: name as "note.created" | "note.updated",
      note: event.note,
    };
  }
  return null;
}

/**
 * `sha256=` and the HMAC of `<timestamp>.<body>` under the webhook's secret.
 * The timestamp is inside what is signed, so a captured delivery cannot be
 * replayed later with a fresh one.
 */
export function signDelivery(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")}`;
}

export function createWebhookDispatcher(
  deps: WebhookDispatcherDeps,
): WebhookDispatcher {
  const { storage, broadcaster, mode } = deps;
  const isAllowedAddress =
    deps.isAllowedAddress ??
    (mode === "private"
      ? (address: string) =>
          isPublicAddress(address) || isLocalNetworkAddress(address)
      : isPublicAddress);
  const delays = deps.retryDelaysMs ?? RETRY_DELAYS_MS;
  /** Per webhook, the tail of its queue. */
  const queues = new Map<string, Promise<void>>();
  let stopped = false;

  async function post(
    webhook: StoredWebhook,
    payload:
      | WebhookPayload
      | { event: "ping"; deliveryId: string; occurredAt: string },
  ): Promise<{ status: number | null; error: string | null }> {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const options: SafeFetchOptions = {
      method: "POST",
      body: Buffer.from(body),
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
        "X-Manifesto-Event": payload.event,
        "X-Manifesto-Delivery": payload.deliveryId,
        "X-Manifesto-Timestamp": timestamp,
        "X-Manifesto-Signature": signDelivery(webhook.secret, timestamp, body),
      },
      accept: "*/*",
      maxBytes: 4096,
      overflow: "truncate",
      timeoutMs: TIMEOUT_MS,
      maxRedirects: 0,
      allowAnyPort: true,
      isAllowedAddress,
      acceptStatus: (status) => status >= 200 && status < 300,
    };
    try {
      const res = await safeFetch(new URL(webhook.url), options);
      return { status: res.status, error: null };
    } catch (err) {
      const status = err instanceof FetchRefused ? (err.status ?? null) : null;
      const message = err instanceof Error ? err.message : String(err);
      return { status, error: message.slice(0, 200) };
    }
  }

  async function deliver(webhook: StoredWebhook, payload: WebhookPayload) {
    let outcome: { status: number | null; error: string | null } = {
      status: null,
      error: null,
    };
    for (const delay of delays) {
      if (stopped) return;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      outcome = await post(webhook, payload);
      if (outcome.error === null) break;
    }
    countMetric(
      "manifesto_webhook_deliveries_total",
      "Webhook deliveries, by whether they got through.",
      { result: outcome.error === null ? "delivered" : "failed" },
    );
    try {
      await storage.webhooks.recordDelivery(webhook.id, {
        at: nowIso(),
        ...outcome,
        failed: outcome.error !== null,
        disableAfter: WEBHOOK_DISABLE_AFTER,
      });
    } catch (err) {
      logger.warn("webhook delivery could not be recorded", {
        webhookId: webhook.id,
        error: String(err),
      });
    }
  }

  function enqueue(webhook: StoredWebhook, payload: WebhookPayload) {
    const tail = queues.get(webhook.id) ?? Promise.resolve();
    const next = tail.then(() => deliver(webhook, payload));
    queues.set(webhook.id, next);
    void next.finally(() => {
      if (queues.get(webhook.id) === next) queues.delete(webhook.id);
    });
  }

  const unsubscribe = broadcaster.subscribe((userId, event) => {
    const name = eventName(event);
    if (!name || stopped) return;
    void storage.webhooks
      .activeFor(userId, name)
      .then((webhooks) => {
        for (const webhook of webhooks) {
          const payload = payloadFor(event, name);
          if (payload) enqueue(webhook, payload);
        }
      })
      .catch((err) => {
        logger.warn("webhooks could not be read", { error: String(err) });
      });
  });

  return {
    ping(webhook) {
      return post(webhook, {
        event: "ping",
        deliveryId: newId(),
        occurredAt: nowIso(),
      });
    },
    async idle() {
      // Reads of the webhook list are in flight briefly before a delivery
      // is queued; one turn lets them land.
      await new Promise((r) => setTimeout(r, 10));
      while (queues.size > 0) await Promise.all(queues.values());
    },
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
}
