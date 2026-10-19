/** The push subscription of a browser, as the server keeps it to send to. */
export interface StoredPushSubscription {
  id: string;
  userId: string;
  /**
   * The session (the hash of its token) with which the browser was signed in
   * when it subscribed. The subscription goes when that session goes, by
   * cascade. Thus, a browser that is signed out, by itself, by a password
   * change or by an admin, gets no more reminders of the account.
   */
  sessionToken: string;
  /** Where the push service of the browser accepts messages for it. */
  endpoint: string;
  /**
   * The public key and the authentication secret of the subscription,
   * base64url.
   */
  p256dh: string;
  auth: string;
  createdAt: string;
  /** Sends that failed in sequence. After too many, it is dropped. */
  failureCount: number;
}

/** Push subscriptions, one row for each browser. */
export interface PushSubscriptionsRepo {
  /**
   * Keeps a subscription. An endpoint is one browser profile. Thus, an endpoint
   * that already exists, of this user or of a different user who signed in
   * there before, is replaced.
   */
  save(subscription: StoredPushSubscription): Promise<void>;
  /** Oldest first. */
  listByUser(userId: string): Promise<StoredPushSubscription[]>;
  /** All persons with one or more subscriptions. */
  userIds(): Promise<string[]>;
  /** The own subscription of the user at this endpoint. */
  deleteByEndpoint(endpoint: string, userId: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  deleteByUser(userId: string): Promise<number>;
  /** Counts a failed send, and answers with its new count. */
  recordFailure(id: string): Promise<number>;
  recordSuccess(id: string): Promise<void>;
}

/**
 * Values that the server makes for itself one time, and must keep across
 * restarts, by name: the key with which it signs push messages. They are not
 * configuration (a host sets none of it), and not a cache (if you lose it, what
 * was made with it breaks).
 */
export interface ServerSecretsRepo {
  get(name: string): Promise<string | null>;
  /**
   * Stores `value` unless the name already has a value, and answers with its
   * value after that. Thus, two processes that start at the same time agree on
   * one. A value that does not open now under the server key counts as none,
   * and is replaced. If the code answered with a value that it did not store,
   * each process, and each start, would use a different value.
   */
  setIfAbsent(name: string, value: string, now: string): Promise<string>;
}
