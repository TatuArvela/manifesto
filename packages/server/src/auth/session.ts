import type { ServerConfig } from "../config.js";
import { isoPlusDays, nowIso } from "../lib/time.js";
import { API_TOKEN_PREFIX, hashToken, newSessionToken } from "../lib/token.js";
import type { Session, StorageDriver } from "../storage/types.js";
import type { SessionRevocations } from "./revocations.js";
import type { AuthIdentity } from "./types.js";

// Sessions are stored hashed at rest. The repo doesn't know this; it just
// indexes whatever string we hand it. The wrapping in `auth/session.ts`
// (and the local/oidc routers, for logout) is responsible for hashing.

type SessionTtlConfig = Pick<
  ServerConfig,
  "sessionTtlDays" | "sessionAbsoluteTtlDays"
>;

/** The earlier of two ISO timestamps. Both come from `toISOString()`, whose
 * fixed-width UTC format sorts lexicographically. */
function earlier(a: string, b: string): string {
  return a < b ? a : b;
}

/**
 * When a session dies no matter how much it is used, measured from when it
 * was minted. Null for a row whose `createdAt` doesn't parse: a corrupt row
 * is treated as expired rather than as immortal.
 */
function absoluteExpiryOf(session: Session, days: number): string | null {
  const created = new Date(session.createdAt);
  if (Number.isNaN(created.getTime())) return null;
  return isoPlusDays(days, created);
}

/**
 * A personal API token (`POST /api/tokens`). It has no sliding expiry, only
 * the one its owner chose, and records when it was last used so a forgotten
 * one can be found and revoked.
 */
async function authenticateByApiToken(
  storage: StorageDriver,
  token: string,
): Promise<AuthIdentity | null> {
  const stored = await storage.apiTokens.findByHash(hashToken(token));
  if (!stored) return null;
  const now = nowIso();
  if (stored.expiresAt !== null && stored.expiresAt < now) return null;
  const user = await storage.users.findById(stored.userId);
  if (!user) return null;
  await storage.apiTokens.touch(stored.id, now);
  return {
    userId: user.id,
    token,
    via: "api-token",
    username: user.username,
    displayName: user.displayName || user.username,
    avatarColor: user.avatarColor,
  };
}

/**
 * The identity behind a bearer token: a session, or, for a token with the API
 * token prefix, a personal API token. Both providers authenticate through
 * this, so tokens work the same under local and single sign-on.
 */
export async function authenticateBySession(
  storage: StorageDriver,
  cfg: SessionTtlConfig,
  token: string,
): Promise<AuthIdentity | null> {
  if (!token) return null;
  if (token.startsWith(API_TOKEN_PREFIX)) {
    return authenticateByApiToken(storage, token);
  }
  const hashed = hashToken(token);
  const session = await storage.sessions.findByToken(hashed);
  if (!session) return null;
  const now = nowIso();
  // Two clocks, either of which can end a session: the sliding expiry the
  // last request wrote, and the absolute one fixed at mint time. Without the
  // second, a session in daily use slides forward forever, and a token captured
  // once is then a permanent credential.
  const absoluteExpiry = absoluteExpiryOf(session, cfg.sessionAbsoluteTtlDays);
  if (
    session.expiresAt < now ||
    absoluteExpiry === null ||
    absoluteExpiry < now
  ) {
    await storage.sessions.deleteByToken(hashed);
    return null;
  }
  const user = await storage.users.findById(session.userId);
  if (!user) return null;
  // Slide, but never past the absolute end, which also means the periodic
  // `deleteExpired` sweep reaps sessions that hit either limit, since both
  // are written into the same `expires_at` column.
  await storage.sessions.touch(
    hashed,
    now,
    earlier(isoPlusDays(cfg.sessionTtlDays), absoluteExpiry),
  );
  return {
    userId: user.id,
    token,
    via: "session",
    username: user.username,
    displayName: user.displayName || user.username,
    avatarColor: user.avatarColor,
  };
}

export async function issueSession(
  storage: StorageDriver,
  cfg: SessionTtlConfig,
  userId: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = newSessionToken();
  const now = nowIso();
  // An absolute lifetime shorter than the sliding one is a legal (if odd)
  // configuration, so the first expiry is capped the same way every later
  // one is.
  const expiresAt = earlier(
    isoPlusDays(cfg.sessionTtlDays),
    isoPlusDays(cfg.sessionAbsoluteTtlDays),
  );
  await storage.sessions.create({
    token: hashToken(token),
    userId,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
  });
  return { token, expiresAt };
}

/** Revoke a session given the raw bearer token the client holds. */
export async function revokeSession(
  storage: StorageDriver,
  token: string,
): Promise<void> {
  await storage.sessions.deleteByToken(hashToken(token));
}

/**
 * End every session a user holds, except `keepToken`'s, and close the sockets
 * those sessions opened. Both halves, because deleting the rows alone leaves
 * an already-open socket authenticated.
 *
 * Their API tokens end too. This runs when a password may be known to someone
 * else (a change, an admin reset), and whoever knew it could have minted a
 * token that would otherwise outlive the reset.
 */
export async function endUserSessions(
  storage: StorageDriver,
  revocations: SessionRevocations,
  userId: string,
  keepToken?: string,
): Promise<void> {
  await storage.sessions.deleteByUser(
    userId,
    keepToken === undefined ? undefined : hashToken(keepToken),
  );
  await storage.apiTokens.deleteByUser(userId);
  revocations.revoke({ userId, keepToken });
}

/** Revoke one API token and close what was opened with it. */
export async function revokeApiToken(
  storage: StorageDriver,
  revocations: SessionRevocations,
  userId: string,
  tokenId: string,
): Promise<boolean> {
  // The hash names the sockets: the raw token was never kept.
  const tokenHash = await storage.apiTokens.delete(tokenId, userId);
  if (tokenHash === null) return false;
  revocations.revoke({ userId, onlyTokenHash: tokenHash });
  return true;
}
