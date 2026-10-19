import { createHmac } from "node:crypto";
import type {
  SealedNote,
  WebhookEventName,
  WebhookNote,
  WebhookPayload,
  WebSocketEvent,
} from "@manifesto/shared";
import type { WebhookMode } from "#/config.ts";
import { logger } from "#/lib/logger.ts";
import { countMetric } from "#/lib/metrics.ts";
import { nowIso } from "#/lib/time.ts";
import { newId } from "#/lib/ulid.ts";
import {
  isLocalNetworkAddress,
  isPublicAddress,
} from "#/linkPreview/addressPolicy.ts";
import {
  FetchRefused,
  type SafeFetchOptions,
  safeFetch,
} from "#/linkPreview/safeFetch.ts";
import type { StorageDriver, StoredWebhook } from "#/storage/types.ts";
import type { Broadcaster } from "#/ws/broadcaster.ts";

/** The number of failures in sequence that switch a webhook off. */
export const WEBHOOK_DISABLE_AFTER = 20;
/** The attempts for each delivery, and the waits between them. */
const RETRY_DELAYS_MS = [0, 5_000, 30_000];
const TIMEOUT_MS = 10_000;
const USER_AGENT =
  "ManifestoWebhook/1.0 (+https://github.com/TatuArvela/manifesto)";

/**
 * Sends the note events of a user to their webhooks.
 *
 * It listens to the broadcaster, which already announces each change to a note
 * to each person who has it, as their own copy. Thus, a webhook gets exactly
 * what the open tabs of its owner get: their own notes, and the notes shared
 * with them, with their personal fields.
 *
 * Deliveries go through `safeFetch`, the SSRF boundary of the link previews. It
 * checks each resolved address, and pins the connection to it. It does not
 * follow redirects. By default, it reaches only public addresses. An operator
 * who runs automation near the server permits its network with
 * `WEBHOOKS=private`.
 *
 * The deliveries of each webhook run one at a time, in order. Thus, a receiver
 * gets the events of a note in the order that they occurred. The dispatcher
 * tries a failed delivery two more times. `WEBHOOK_DISABLE_AFTER` failures in
 * sequence switch the webhook off, until its owner turns it on again.
 */
export interface WebhookDispatcher {
  /** Sends one event now (the "send test" button), and tells the result. */
  ping(
    webhook: StoredWebhook,
  ): Promise<{ status: number | null; error: string | null }>;
  /** Resolves when all queued deliveries are complete. For tests. */
  idle(): Promise<void>;
  stop(): void;
}

export interface WebhookDispatcherDeps {
  storage: StorageDriver;
  broadcaster: Broadcaster;
  mode: Exclude<WebhookMode, "off">;
  /** Test seam: the address rule, which production takes from `mode`. */
  isAllowedAddress?: ((address: string) => boolean) | undefined;
  /** Test seam: makes the waits between attempts shorter. */
  retryDelaysMs?: number[] | undefined;
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

/** The readable part of a note, which is all that a delivery contains. */
export function webhookNoteOf(note: SealedNote): WebhookNote {
  return {
    id: note.id,
    pinned: note.pinned,
    archived: note.archived,
    trashed: note.trashed,
    trashedAt: note.trashedAt,
    position: note.position,
    reminder: note.reminder,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    ...(note.readonly !== undefined && { readonly: note.readonly }),
    ...(note.source !== undefined && { source: note.source }),
    ...(note.sharing !== undefined && { sharing: note.sharing }),
  };
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
      note: webhookNoteOf(event.note),
    };
  }
  return null;
}

/**
 * `sha256=` and the HMAC of `<timestamp>.<body>` under the secret of the
 * webhook. The timestamp is inside the signed data. Thus, nobody can send a
 * captured delivery again later with a new timestamp.
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
  /** For each webhook, the end of its queue. */
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
      // The reads of the webhook list are in progress for a short time before a
      // delivery is queued. One turn lets them complete.
      await new Promise((r) => setTimeout(r, 10));
      while (queues.size > 0) await Promise.all(queues.values());
    },
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
}
