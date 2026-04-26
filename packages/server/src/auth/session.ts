import type { ServerConfig } from "../config.js";
import { isoPlusDays, nowIso } from "../lib/time.js";
import { hashToken, newSessionToken } from "../lib/token.js";
import type { StorageDriver } from "../storage/types.js";
import type { AuthIdentity } from "./types.js";

// Sessions are stored hashed at rest. The repo doesn't know this — it just
// indexes whatever string we hand it. The wrapping in `auth/session.ts`
// (and the local/oidc routers, for logout) is responsible for hashing.

export async function authenticateBySession(
  storage: StorageDriver,
  cfg: Pick<ServerConfig, "sessionTtlDays">,
  token: string,
): Promise<AuthIdentity | null> {
  if (!token) return null;
  const hashed = hashToken(token);
  const session = await storage.sessions.findByToken(hashed);
  if (!session) return null;
  const now = nowIso();
  if (session.expiresAt < now) {
    await storage.sessions.deleteByToken(hashed);
    return null;
  }
  const user = await storage.users.findById(session.userId);
  if (!user) return null;
  await storage.sessions.touch(hashed, now, isoPlusDays(cfg.sessionTtlDays));
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
  cfg: Pick<ServerConfig, "sessionTtlDays">,
  userId: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = newSessionToken();
  const now = nowIso();
  const expiresAt = isoPlusDays(cfg.sessionTtlDays);
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
