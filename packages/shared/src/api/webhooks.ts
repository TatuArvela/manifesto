import type { Note } from "../note.js";

/** The note events a webhook can be sent. */
export const WEBHOOK_EVENTS = [
  "note.created",
  "note.updated",
  "note.deleted",
] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

/** A webhook as listed: never its signing secret, shown once at creation. */
export interface Webhook {
  id: string;
  url: string;
  events: WebhookEventName[];
  active: boolean;
  createdAt: string;
  /** The last delivery: when, and the status it got or why it failed. */
  lastDeliveryAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
  /** Failures in a row; enough of them switches the webhook off. */
  failureCount: number;
}

export interface WebhooksResponse {
  webhooks: Webhook[];
}

export interface WebhookCreateRequest {
  url: string;
  /** Every event when left out. */
  events?: WebhookEventName[];
}

export interface WebhookCreatedResponse {
  webhook: Webhook;
  /** Signs every delivery (`X-Manifesto-Signature`). Shown this once. */
  secret: string;
}

/**
 * The body of every webhook delivery. `note` is the copy the webhook's owner
 * sees, their own color and tags included; a deletion carries only the id.
 */
export type WebhookPayload =
  | {
      event: "note.created" | "note.updated";
      deliveryId: string;
      occurredAt: string;
      note: Note;
    }
  | {
      event: "note.deleted";
      deliveryId: string;
      occurredAt: string;
      noteId: string;
    };
