import {
  API_TOKEN_SCOPES,
  type ApiTokenKind,
  type ApiTokenScope,
} from "@manifesto/shared";
import type { StoredApiToken } from "./types.js";

export interface ApiTokenRow {
  id: string;
  user_id: string;
  name: string;
  kind: string;
  /** A JSON array of `ApiTokenScope`. */
  scopes: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

export const API_TOKEN_COLUMNS =
  "id, user_id, name, kind, scopes, prefix, created_at, last_used_at, expires_at";

/** The scopes a row names, leaving out any this server does not know: a
 * scope is a grant, so an unreadable one grants nothing. */
function parseScopes(text: string): ApiTokenScope[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return API_TOKEN_SCOPES.filter((scope) => parsed.includes(scope));
}

export function rowToApiToken(row: ApiTokenRow): StoredApiToken {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    // Anything unknown reads as the narrowest that signs in to nothing
    // but its own route.
    kind: (row.kind === "api" || row.kind === "calendar"
      ? row.kind
      : "mcp") satisfies ApiTokenKind,
    scopes: parseScopes(row.scopes),
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
