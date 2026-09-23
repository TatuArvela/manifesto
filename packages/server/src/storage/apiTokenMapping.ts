import type { StoredApiToken } from "./types.js";

export interface ApiTokenRow {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

export const API_TOKEN_COLUMNS =
  "id, user_id, name, prefix, created_at, last_used_at, expires_at";

export function rowToApiToken(row: ApiTokenRow): StoredApiToken {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
  };
}

/** A listed token: whose it is goes without saying. */
export function listedToken({ userId: _userId, ...token }: StoredApiToken) {
  return token;
}
