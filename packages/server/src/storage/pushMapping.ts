import { AT_REST, atRest } from "./atRest.js";
import type { StoredPushSubscription } from "./types.js";

/** A subscription as it is stored: the browser's two keys, which whoever
 * holds them could send it messages with, under the server key. */
export function sealedSubscription(
  subscription: StoredPushSubscription,
): StoredPushSubscription {
  return {
    ...subscription,
    p256dh: atRest.seal(subscription.p256dh, AT_REST.pushKey),
    auth: atRest.seal(subscription.auth, AT_REST.pushKey),
  };
}

export const PUSH_COLUMNS =
  "id, user_id, session_token, endpoint, p256dh, auth, created_at, failure_count";

export interface PushRow {
  id: string;
  user_id: string;
  session_token: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
  failure_count: number;
}

export function rowToPushSubscription(row: PushRow): StoredPushSubscription {
  return {
    id: row.id,
    userId: row.user_id,
    sessionToken: row.session_token,
    endpoint: row.endpoint,
    // Under the server key; one that no longer opens encrypts to nobody,
    // and the send that fails drops the subscription.
    p256dh: atRest.open(row.p256dh, AT_REST.pushKey) ?? "",
    auth: atRest.open(row.auth, AT_REST.pushKey) ?? "",
    createdAt: row.created_at,
    failureCount: Number(row.failure_count),
  };
}
