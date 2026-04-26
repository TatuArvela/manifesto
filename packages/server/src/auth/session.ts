import type { ServerConfig } from "../config.js";
import { isoPlusDays, nowIso } from "../lib/time.js";
import { newSessionToken } from "../lib/token.js";
import type { StorageDriver } from "../storage/types.js";
import type { AuthIdentity } from "./types.js";

export async function authenticateBySession(
  storage: StorageDriver,
  cfg: Pick<ServerConfig, "sessionTtlDays">,
  token: string,
): Promise<AuthIdentity | null> {
  if (!token) return null;
  const session = await storage.sessions.findByToken(token);
  if (!session) return null;
  const now = nowIso();
  if (session.expiresAt < now) {
    await storage.sessions.deleteByToken(token);
    return null;
  }
  const user = await storage.users.findById(session.userId);
  if (!user) return null;
  await storage.sessions.touch(token, now, isoPlusDays(cfg.sessionTtlDays));
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
    token,
    userId,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
  });
  return { token, expiresAt };
}
