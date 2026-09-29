import type { ApiTokenScope } from "@manifesto/shared";

// What a grant here can be: its scopes, how long its parts last, and the one
// resource it reaches.

/** What an assistant can be given: its tools reach notes and nothing else. */
export const MCP_OAUTH_SCOPES = [
  "notes:read",
  "notes:write",
] as const satisfies readonly ApiTokenScope[];

/** How long an access token works before the refresh token is needed. */
export const ACCESS_TOKEN_SECONDS = 60 * 60;

/** How long the code a consent hands out can be traded for a grant. */
export const CODE_TTL_MS = 2 * 60 * 1000;

/** A client that registered and has not been given a grant within this long
 * is swept (`jobs/sessionCleanup.ts`). */
export const UNUSED_CLIENT_DAYS = 1;

export const GRANT_TYPES = ["authorization_code", "refresh_token"];

/**
 * `notes:read`, with `notes:write` when it was asked for, from a space-separated
 * `scope`; both when none was named. Empty when it names nothing an assistant
 * can have.
 */
export function requestedScopes(scope: string | undefined): ApiTokenScope[] {
  const names = (scope ?? "").split(/\s+/).filter(Boolean);
  if (names.length === 0) return [...MCP_OAUTH_SCOPES];
  if (names.includes("notes:write")) return [...MCP_OAUTH_SCOPES];
  return names.includes("notes:read") ? ["notes:read"] : [];
}

/** Whether a `resource` names `/api/mcp`, the one thing a grant reaches. */
export function namesMcp(resource: string): boolean {
  try {
    return new URL(resource).pathname.replace(/\/+$/, "") === "/api/mcp";
  } catch {
    return false;
  }
}

/** An ISO timestamp `ms` after another. Expiries are counted from `nowIso`,
 * which they are compared with, and which never goes back. */
export function plusMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

/** The earlier of two ISO timestamps, a null one being never. */
export function earlier(a: string, b: string | null): string {
  return b !== null && b < a ? b : a;
}
