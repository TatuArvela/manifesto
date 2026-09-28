import { parseScopes } from "./apiTokenMapping.js";
import type { StoredOAuthClient, StoredOAuthCode } from "./types.js";

export interface OAuthClientRow {
  id: string;
  name: string;
  /** A JSON array of addresses. */
  redirect_uris: string;
  created_at: string;
  last_used_at: string | null;
}

export interface OAuthCodeRow {
  code_hash: string;
  client_id: string;
  client_name: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  /** A JSON array of `ApiTokenScope`. */
  scopes: string;
  grant_expires_at: string | null;
  expires_at: string;
}

export const OAUTH_CLIENT_COLUMNS =
  "id, name, redirect_uris, created_at, last_used_at";

export const OAUTH_CODE_COLUMNS =
  "code_hash, client_id, client_name, user_id, redirect_uri, code_challenge, scopes, grant_expires_at, expires_at";

/** The addresses a row names; an unreadable list names none, so nothing can
 * be redirected to through it. */
function parseUris(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  return Array.isArray(parsed)
    ? parsed.filter((uri): uri is string => typeof uri === "string")
    : [];
}

export function rowToOAuthClient(row: OAuthClientRow): StoredOAuthClient {
  return {
    id: row.id,
    name: row.name,
    redirectUris: parseUris(row.redirect_uris),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export function rowToOAuthCode(row: OAuthCodeRow): StoredOAuthCode {
  return {
    codeHash: row.code_hash,
    clientId: row.client_id,
    clientName: row.client_name,
    userId: row.user_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    scopes: parseScopes(row.scopes),
    grantExpiresAt: row.grant_expires_at,
    expiresAt: row.expires_at,
  };
}
