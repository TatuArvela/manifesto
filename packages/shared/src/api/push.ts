/** The maximum number of browsers that one account can subscribe for push. */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;

/** `GET /api/v1/push/key`: the key with which a browser subscribes. */
export interface PushKeyResponse {
  /** The push public key of the server, base64url: `applicationServerKey`. */
  publicKey: string;
}

/**
 * `POST /api/v1/push/subscriptions`: the subscription of a browser, as
 * `PushSubscription.toJSON()` gives it. `DELETE` takes only the `endpoint`.
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
 * What a push contains, encrypted to the browser: a reminder that became due
 * when no open client fired it. The service worker shows it, and moves its own
 * copy of the reminder to `next`. Thus, it does not fire it a second time.
 */
/** The sealed half of a reminder push. See `ReminderPush`. */
export interface SealedReminder {
  keyVersion: number;
  key: string;
  title: string;
  excerpt: string;
}

export interface ReminderPush {
  type: "reminder";
  noteId: string;
  /**
   * What to show when the device has no key to open `sealed`: the words of the
   * app for a reminder, and no data of the note.
   */
  title: string;
  body: string;
  /**
   * What the reminder is about. Only a device that has the keys of the account
   * can read it: the sealed title and excerpt of the note, and the note key as
   * its reader keeps it, wrapped under their notes key. Absent when the copy of
   * the key of the reader is behind that of the note.
   */
  sealed?: SealedReminder;
  /**
   * The next time of the reminder. Null for a reminder that keeps its time: one
   * that does not repeat, or an urgent one that waits until the user marks it
   * done.
   */
  next: { time: string; day?: number } | null;
  firedAt: string;
  /** The reminder is urgent: its notification stays until it is dismissed. */
  urgent?: true;
}
