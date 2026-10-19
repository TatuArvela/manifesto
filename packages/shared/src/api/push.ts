/** How many browsers one account can have subscribed for push at once. */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;

/** `GET /api/v1/push/key`: the key a browser subscribes with. */
export interface PushKeyResponse {
  /** The server's push public key, base64url: `applicationServerKey`. */
  publicKey: string;
}

/**
 * `POST /api/v1/push/subscriptions`: a browser's subscription, as
 * `PushSubscription.toJSON()` gives it. `DELETE` takes the `endpoint` alone.
 */
export interface PushSubscribeRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** `DELETE /api/v1/push/subscriptions`. */
export interface PushUnsubscribeRequest {
  endpoint: string;
}

/**
 * What a push carries, encrypted to the browser: a reminder that came due
 * with no open client to fire it. The service worker shows it, and moves its
 * own copy of the reminder to `next` so it does not fire it a second time.
 */
/** The sealed half of a reminder push; see `ReminderPush`. */
export interface SealedReminder {
  keyVersion: number;
  key: string;
  title: string;
  excerpt: string;
}

export interface ReminderPush {
  type: "reminder";
  noteId: string;
  /** What to show when the device has no key to open `sealed` with: the
   * app's words for a reminder, and nothing of the note. */
  title: string;
  body: string;
  /**
   * What the reminder is about, which only a device holding the account's
   * keys can read: the note's sealed title and excerpt, and the note key as
   * its reader keeps it, wrapped under their notes key. Absent when the
   * reader's copy of the key is behind the note's.
   */
  sealed?: SealedReminder;
  /** Where the reminder goes from here; null for one that does not repeat. */
  next: { time: string; day?: number } | null;
  firedAt: string;
}
