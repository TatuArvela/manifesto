import { WEBHOOK_EVENTS, type WebhookEventName } from "@manifesto/shared";
import { parseJson } from "./noteMapping.js";
import type { StoredWebhook } from "./types.js";

export interface WebhookRow {
  id: string;
  user_id: string;
  url: string;
  secret: string;
  events: string;
  active: number | boolean;
  created_at: string;
  last_delivery_at: string | null;
  last_status: number | null;
  last_error: string | null;
  failure_count: number | string;
}

const KNOWN = new Set<string>(WEBHOOK_EVENTS);

export function rowToWebhook(row: WebhookRow): StoredWebhook {
  const events = parseJson<unknown>(row.events, []);
  return {
    id: row.id,
    userId: row.user_id,
    url: row.url,
    secret: row.secret,
    events: Array.isArray(events)
      ? events.filter((e): e is WebhookEventName => KNOWN.has(e))
      : [],
    active: row.active === true || row.active === 1,
    createdAt: row.created_at,
    lastDeliveryAt: row.last_delivery_at,
    lastStatus: row.last_status === null ? null : Number(row.last_status),
    lastError: row.last_error,
    failureCount: Number(row.failure_count),
  };
}

/** A listed webhook: the secret stays on the server. */
export function listedWebhook({
  secret: _secret,
  userId: _userId,
  ...webhook
}: StoredWebhook) {
  return webhook;
}
