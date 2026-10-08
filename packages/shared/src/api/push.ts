/** How many browsers one account can have subscribed for push at once. */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;

/** `GET /api/push/key`: the key a browser subscribes with. */
export interface PushKeyResponse {
  /** The server's push public key, base64url: `applicationServerKey`. */
  publicKey: string;
}

/**
 * `POST /api/push/subscriptions`: a browser's subscription, as
 * `PushSubscription.toJSON()` gives it. `DELETE` takes the `endpoint` alone.
 */
export interface PushSubscribeRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** `DELETE /api/push/subscriptions`. */
export interface PushUnsubscribeRequest {
  endpoint: string;
}

/**
 * What a push carries, encrypted to the browser: a reminder that came due
 * with no open client to fire it. The service worker shows it, and moves its
 * own copy of the reminder to `next` so it does not fire it a second time.
 */
export interface ReminderPush {
  type: "reminder";
  noteId: string;
  title: string;
  body: string;
  /** Where the reminder goes from here; null for one that does not repeat. */
  next: { time: string; day?: number } | null;
  firedAt: string;
}
