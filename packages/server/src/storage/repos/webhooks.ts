import type { Webhook, WebhookEventName } from "@manifesto/shared";

// Webhooks, and the record of their deliveries.

export interface StoredWebhook extends Webhook {
  userId: string;
  secret: string;
}

export interface WebhookDeliveryResult {
  at: string;
  status: number | null;
  error: string | null;
  /**
   * True for a failed delivery: the count increases, and the webhook switches
   * off at `disableAfter` failures in sequence. False resets the count.
   */
  failed: boolean;
  disableAfter: number;
}

export interface WebhooksRepo {
  create(input: StoredWebhook): Promise<void>;
  listByUser(userId: string): Promise<StoredWebhook[]>;
  /** The active webhooks of a user that subscribe to `event`. */
  activeFor(userId: string, event: WebhookEventName): Promise<StoredWebhook[]>;
  get(id: string, userId: string): Promise<StoredWebhook | null>;
  delete(id: string, userId: string): Promise<boolean>;
  /**
   * Enables again a webhook that failures switched off, and clears its count.
   */
  setActive(id: string, userId: string, active: boolean): Promise<boolean>;
  recordDelivery(id: string, result: WebhookDeliveryResult): Promise<void>;
}
