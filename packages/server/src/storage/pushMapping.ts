import type { StoredPushSubscription } from "./types.js";

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
    p256dh: row.p256dh,
    auth: row.auth,
    createdAt: row.created_at,
    failureCount: Number(row.failure_count),
  };
}
