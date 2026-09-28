import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Hash a bearer token for at-rest storage. The session row in the DB stores
 * `sha256(token)`; the raw token is only ever held by the client. A leaked
 * DB backup therefore cannot be replayed against the live server.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * What every personal API token starts with. It tells `authenticate` which
 * table to look in, and lets a secret scanner (or a person) recognise one in
 * a leaked file.
 */
export const API_TOKEN_PREFIX = "mfp_";

/** The same for a token only `/api/mcp` accepts, minted for an AI assistant. */
export const MCP_TOKEN_PREFIX = "mfm_";

/** The same for an OAuth grant's refresh token, which an assistant trades
 * for the next access token. Never a bearer token: `authenticateBySession`
 * does not know this prefix. */
export const REFRESH_TOKEN_PREFIX = "mfr_";

/** The same for the secret in a reminder feed's address. Never a bearer
 * token: `authenticateBySession` does not know this prefix. */
export const CALENDAR_TOKEN_PREFIX = "mfc_";

/** Enough for any honest set of scripts and assistants, and a bound on a
 * runaway one. */
export const MAX_API_TOKENS_PER_USER = 50;

/** Characters of the secret kept to tell tokens apart: the prefix and six. */
export const SHOWN_PREFIX_LENGTH = 10;

export function newApiToken(prefix: string = API_TOKEN_PREFIX): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

/** Compares two secrets in time that does not depend on where they differ. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
