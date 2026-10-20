import type { ApiTokenScope } from "@manifesto/shared";

// What a grant here can be: its scopes, how long its parts last, and the one
// resource that it reaches.

/** What an assistant can get. Its tools reach notes and nothing else. */
export const MCP_OAUTH_SCOPES = [
  "notes:read",
  "notes:write",
] as const satisfies readonly ApiTokenScope[];

/** How long an access token works before the refresh token is necessary. */
export const ACCESS_TOKEN_SECONDS = 60 * 60;

/** How long the code from a consent can be traded for a grant. */
export const CODE_TTL_MS = 2 * 60 * 1000;

/**
 * The server sweeps a client that registered and got no grant within this time
 * (`jobs/sessionCleanup.ts`).
 */
export const UNUSED_CLIENT_DAYS = 1;

export const GRANT_TYPES = ["authorization_code", "refresh_token"];

/**
 * `notes:read`, with `notes:write` when the client asked for it, from a `scope`
 * separated by spaces. Both when it names none. Empty when it names nothing
 * that an assistant can have.
 */
export function requestedScopes(scope: string | undefined): ApiTokenScope[] {
  const names = (scope ?? "").split(/\s+/).filter(Boolean);
  if (names.length === 0) return [...MCP_OAUTH_SCOPES];
  if (names.includes("notes:write")) return [...MCP_OAUTH_SCOPES];
  return names.includes("notes:read") ? ["notes:read"] : [];
}

/**
 * If a `resource` names `/api/v1/mcp`, the only thing that a grant reaches, or
 * `/api/mcp`, its address before the API had a version. An assistant that
 * connected then still names it when it refreshes.
 */
export function namesMcp(resource: string): boolean {
  try {
    const path = new URL(resource).pathname.replace(/\/+$/, "");
    return path === "/api/v1/mcp" || path === "/api/mcp";
  } catch {
    return false;
  }
}

/**
 * An ISO timestamp `ms` after a different one. Expiries count from `nowIso`,
 * with which the code compares them, and which never goes back.
 */
export function plusMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

/** The earlier of two ISO timestamps. A null timestamp means never. */
export function earlier(a: string, b: string | null): string {
  return b !== null && b < a ? b : a;
}
