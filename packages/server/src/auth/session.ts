import type { ServerConfig } from "../config.js";
import { isoPlusDays, nowIso } from "../lib/time.js";
import { hashToken, newSessionToken } from "../lib/token.js";
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

export async function authenticateBySession(
  storage: StorageDriver,
  cfg: SessionTtlConfig,
  token: string,
): Promise<AuthIdentity | null> {
  if (!token) return null;
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
  revocations.revoke({ userId, keepToken });
}
