import type { Webhook, WebhookEventName } from "@manifesto/shared";

// Webhooks and the record of their deliveries.

export interface StoredWebhook extends Webhook {
  userId: string;
  secret: string;
}

export interface WebhookDeliveryResult {
  at: string;
  status: number | null;
  error: string | null;
  /** True for a delivery that failed: counts up, and switches the webhook
   * off at `disableAfter` failures in a row. False resets the count. */
  failed: boolean;
  disableAfter: number;
}

export interface WebhooksRepo {
  create(input: StoredWebhook): Promise<void>;
  listByUser(userId: string): Promise<StoredWebhook[]>;
  /** Active webhooks of a user subscribed to `event`. */
  activeFor(userId: string, event: WebhookEventName): Promise<StoredWebhook[]>;
  get(id: string, userId: string): Promise<StoredWebhook | null>;
  delete(id: string, userId: string): Promise<boolean>;
  /** Re-enables one switched off by failures, and clears its count. */
  setActive(id: string, userId: string, active: boolean): Promise<boolean>;
  recordDelivery(id: string, result: WebhookDeliveryResult): Promise<void>;
}
