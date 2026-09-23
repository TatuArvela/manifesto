import { createHash, randomBytes } from "node:crypto";

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

export function newApiToken(): string {
  return `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}
