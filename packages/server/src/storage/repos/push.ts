/** A browser's push subscription, as the server keeps it to send to. */
export interface StoredPushSubscription {
  id: string;
  userId: string;
  /**
   * The session (its token's hash) the browser was signed in with when it
   * subscribed. The subscription goes when that session does, by cascade: a
   * browser that is signed out, by itself, by a password change or by an
   * admin, gets no more of the account's reminders.
   */
  sessionToken: string;
  /** Where the browser's push service takes messages for it. */
  endpoint: string;
  /** The subscription's public key and authentication secret, base64url. */
  p256dh: string;
  auth: string;
  createdAt: string;
  /** Sends that failed in a row; enough of them and it is dropped. */
  failureCount: number;
}

/** Push subscriptions, one row a browser. */
export interface PushSubscriptionsRepo {
  /**
   * Keeps a subscription. An endpoint is one browser profile, so one already
   * held, by this user or another who signed in there before, is replaced.
   */
  save(subscription: StoredPushSubscription): Promise<void>;
  /** Oldest first. */
  listByUser(userId: string): Promise<StoredPushSubscription[]>;
  /** Everyone with at least one subscription. */
  userIds(): Promise<string[]>;
  /** The user's own subscription at this endpoint. */
  deleteByEndpoint(endpoint: string, userId: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  deleteByUser(userId: string): Promise<number>;
  /** Counts a failed send, and answers with the count it reached. */
  recordFailure(id: string): Promise<number>;
  recordSuccess(id: string): Promise<void>;
}

/**
 * Values the server makes for itself once and has to keep across restarts,
 * by name: the key it signs push messages with. Not configuration (a host
 * sets none of it) and not a cache (losing it breaks what was made with it).
 */
export interface ServerSecretsRepo {
  get(name: string): Promise<string | null>;
  /**
   * Stores `value` unless the name already holds one, and answers with what
   * it holds afterwards, so two processes starting at once agree on one.
   */
  setIfAbsent(name: string, value: string, now: string): Promise<string>;
}
