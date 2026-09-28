import type { ApiTokenKind } from "@manifesto/shared";
import type { StoredApiToken } from "./types.js";

export interface ApiTokenRow {
  id: string;
  user_id: string;
  name: string;
  kind: string;
  /** 0 or 1 from SQLite, a boolean from Postgres. */
  read_only: number | boolean;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

export const API_TOKEN_COLUMNS =
  "id, user_id, name, kind, read_only, prefix, created_at, last_used_at, expires_at";

export function rowToApiToken(row: ApiTokenRow): StoredApiToken {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    // Only these two are ever written; anything else reads as the narrower.
    kind: (row.kind === "api" ? "api" : "mcp") satisfies ApiTokenKind,
    readOnly: Boolean(row.read_only),
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
