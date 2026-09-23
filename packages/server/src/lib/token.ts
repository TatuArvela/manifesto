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

export function newApiToken(): string {
  return `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Compares two secrets in time that does not depend on where they differ. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
