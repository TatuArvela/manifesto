import type { Note } from "#/note.ts";

/** The note events that a webhook can get. */
export const WEBHOOK_EVENTS = [
  "note.created",
  "note.updated",
  "note.deleted",
] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

/** A webhook as listed. Never its signing secret, which shows one time. */
export interface Webhook {
  id: string;
  url: string;
  events: WebhookEventName[];
  active: boolean;
  createdAt: string;
  /** The last delivery: when, and its status or the reason of its failure. */
  lastDeliveryAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
  /** Failures in sequence. Too many of them switch the webhook off. */
  failureCount: number;
}

export interface WebhooksResponse {
  webhooks: Webhook[];
}

export interface WebhookCreateRequest {
  url: string;
  /** All events when not given. */
  events?: WebhookEventName[];
}

export interface WebhookCreatedResponse {
  webhook: Webhook;
  /** Signs each delivery (`X-Manifesto-Signature`). Shown this one time. */
  secret: string;
}

/**
 * What a delivery tells about a note: the fields that the server reads, as the
 * owner of the webhook has them. A webhook fires on a change in the app, when
 * the server has no key. Thus, it contains no title, text or tags. A receiver
 * that needs them reads the note with an API token.
 */
export type WebhookNote = Pick<
  Note,
  | "id"
  | "pinned"
  | "archived"
  | "trashed"
  | "trashedAt"
  | "position"
  | "reminder"
  | "createdAt"
  | "updatedAt"
  | "readonly"
  | "source"
  | "sharing"
>;

/** The body of each webhook delivery. A deletion contains only the id. */
export type WebhookPayload =
  | {
      event: "note.created" | "note.updated";
      deliveryId: string;
      occurredAt: string;
      note: WebhookNote;
    }
  | {
      event: "note.deleted";
      deliveryId: string;
      occurredAt: string;
      noteId: string;
    };
