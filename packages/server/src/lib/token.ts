import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Hash a bearer token for storage at rest. The session row in the database
 * stores `sha256(token)`. Only the client ever has the raw token. Thus, nobody
 * can use a leaked database backup against the live server.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * The start of each personal API token. It tells `authenticate` which table to
 * look in. It also lets a secret scanner (or a person) find one in a leaked
 * file.
 */
export const API_TOKEN_PREFIX = "mfp_";

/**
 * The same for a token that only `/api/v1/mcp` accepts, made for an AI
 * assistant.
 */
export const MCP_TOKEN_PREFIX = "mfm_";

/**
 * The same for the refresh token of an OAuth grant, which an assistant trades
 * for the next access token. It is never a bearer token:
 * `authenticateBySession` does not know this prefix.
 */
export const REFRESH_TOKEN_PREFIX = "mfr_";

/**
 * The same for the secret in the address of a reminder feed. It is never a
 * bearer token: `authenticateBySession` does not know this prefix.
 */
export const CALENDAR_TOKEN_PREFIX = "mfc_";

/**
 * Sufficient for all honest scripts and assistants, and a limit on a script
 * that is out of control.
 */
export const MAX_API_TOKENS_PER_USER = 50;

/**
 * The characters of the secret kept to tell tokens apart: the prefix and six.
 */
export const SHOWN_PREFIX_LENGTH = 10;

export function newApiToken(prefix: string = API_TOKEN_PREFIX): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

/**
 * Compares two secrets in a time that does not depend on where they are
 * different.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
