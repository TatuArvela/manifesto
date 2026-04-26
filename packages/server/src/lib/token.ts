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
