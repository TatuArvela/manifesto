import type { ServerConfig } from "#/config.ts";
import { isFeatureOn, TOKEN_FEATURES, type ToggleFeature } from "#/features.ts";
import { isoPlusDays, nowIso } from "#/lib/time.ts";
import {
  API_TOKEN_PREFIX,
  hashToken,
  MCP_TOKEN_PREFIX,
  newSessionToken,
} from "#/lib/token.ts";
import type { Session, StorageDriver } from "#/storage/types.ts";
import type { SessionRevocations } from "./revocations.ts";
import type { AuthIdentity } from "./types.ts";

// Sessions are stored hashed at rest. The repo does not know this. It only
// indexes the string that it gets. The wrapper in `auth/session.ts` (and the
// local/oidc routers, for logout) does the hash.

type SessionTtlConfig = Pick<
  ServerConfig,
  "sessionTtlDays" | "sessionAbsoluteTtlDays"
>;

/**
 * What the server checks a bearer token against: the session clocks, and the
 * token types that the features of the server still accept.
 */
type BearerConfig = SessionTtlConfig &
  Pick<ServerConfig, ToggleFeature | "webhooks">;

/**
 * The earlier of two ISO timestamps. Both come from `toISOString()`, whose
 * fixed-width UTC format sorts lexicographically.
 */
function earlier(a: string, b: string): string {
  return a < b ? a : b;
}

/**
 * When a session ends, whatever its use, from the time when it was made. Null
 * for a row whose `createdAt` does not parse. A corrupt row counts as expired,
 * not as permanent.
 */
function absoluteExpiryOf(session: Session, days: number): string | null {
  const created = new Date(session.createdAt);
  if (Number.isNaN(created.getTime())) return null;
  return isoPlusDays(days, created);
}

/**
 * A personal API token or MCP token (`POST /api/v1/tokens`). It has no sliding
 * expiry, only the expiry that its owner selected. It records its last use, so
 * that a person can find and revoke a forgotten token. It is refused while the
 * feature of its type is off (`API_TOKENS`, `MCP`). This also applies to both
 * sockets, because they authenticate through here.
 */
async function authenticateByApiToken(
  storage: StorageDriver,
  cfg: BearerConfig,
  token: string,
): Promise<AuthIdentity | null> {
  // The prefix is only the prefix with which the secret was made. The row
  // decides. A prefix that does not agree with it is a secret that nobody got.
  const kind = token.startsWith(MCP_TOKEN_PREFIX) ? "mcp" : "api";
  if (!isFeatureOn(cfg, TOKEN_FEATURES[kind])) return null;
  const stored = await storage.apiTokens.findByHash(hashToken(token));
  if (!stored) return null;
  if (stored.kind !== kind) return null;
  const now = nowIso();
  if (stored.expiresAt !== null && stored.expiresAt < now) return null;
  // The access token of an OAuth grant expires within one hour. The assistant
  // gets the next one with its refresh token (`oauth/tokenEndpoint.ts`).
  if (stored.accessExpiresAt !== null && stored.accessExpiresAt < now) {
    return null;
  }
  const user = await storage.users.findById(stored.userId);
  if (!user) return null;
  await storage.apiTokens.touch(stored.id, now);
  return {
    userId: user.id,
    token,
    via: kind === "mcp" ? "mcp-token" : "api-token",
    scopes: stored.scopes,
    ...(stored.wrappedKeys !== null && { wrappedKeys: stored.wrappedKeys }),
    username: user.username,
    displayName: user.displayName || user.username,
    avatarColor: user.avatarColor,
  };
}

/**
 * The identity behind a bearer token: a session or, for a token with the API or
 * MCP token prefix, a personal token. Both providers authenticate through this.
 * Thus, tokens work the same with local sign-in and with single sign-on.
 */
export async function authenticateBySession(
  storage: StorageDriver,
  cfg: BearerConfig,
  token: string,
): Promise<AuthIdentity | null> {
  if (!token) return null;
  if (
    token.startsWith(API_TOKEN_PREFIX) ||
    token.startsWith(MCP_TOKEN_PREFIX)
  ) {
    return authenticateByApiToken(storage, cfg, token);
  }
  const hashed = hashToken(token);
  const session = await storage.sessions.findByToken(hashed);
  if (!session) return null;
  const now = nowIso();
  // Two clocks, and either one can end a session: the sliding expiry that the
  // last request wrote, and the absolute expiry set when it was made. Without
  // the second, a session in daily use moves forward forever, and a token that
  // a person captured one time becomes a permanent credential.
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
  // Slide, but never past the absolute end. Thus, the periodic `deleteExpired`
  // sweep also removes sessions that reach either limit, because both are
  // written into the same `expires_at` column.
  await storage.sessions.touch(
    hashed,
    now,
    earlier(isoPlusDays(cfg.sessionTtlDays), absoluteExpiry),
  );
  return {
    userId: user.id,
    token,
    via: "session",
    signedInAt: session.createdAt,
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
  // An absolute lifetime shorter than the sliding lifetime is a legal
  // configuration (but strange). Thus, the first expiry has the same limit as
  // all later expiries.
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

/** Revoke a session from the raw bearer token that the client has. */
export async function revokeSession(
  storage: StorageDriver,
  token: string,
): Promise<void> {
  await storage.sessions.deleteByToken(hashToken(token));
}

/**
 * End all sessions of a user, except that of `keepToken`, and close the sockets
 * of those sessions. Both parts are necessary, because when you delete only the
 * rows, an open socket stays authenticated.
 *
 * Their API tokens also end. This runs when a different person can know a
 * password (a change, an admin reset), and that person could have made a token
 * that would otherwise stay after the reset. A sign-in link that is still in
 * their mailbox goes for the same reason: it would be a session a moment later.
 * A reset link also goes, because it would be the password.
 *
 * `keepApiTokens` is for a new secret key (`auth/accountKeys.ts`). That signs
 * out the other devices of the account so that they ask for it, and tells
 * nothing about who knows the password. The sockets of the tokens close with
 * the others, and connect again.
 */
export async function endUserSessions(
  storage: StorageDriver,
  revocations: SessionRevocations,
  userId: string,
  keepToken?: string,
  options: { keepApiTokens?: boolean } = {},
): Promise<void> {
  await storage.sessions.deleteByUser(
    userId,
    keepToken === undefined ? undefined : hashToken(keepToken),
  );
  if (!options.keepApiTokens) await storage.apiTokens.deleteByUser(userId);
  await storage.signInLinks.deleteByUser(userId);
  await storage.passwordResets.deleteByUser(userId);
  revocations.revoke({ userId, keepToken });
}

/** Revoke one API token, and close what it opened. */
export async function revokeApiToken(
  storage: StorageDriver,
  revocations: SessionRevocations,
  userId: string,
  tokenId: string,
): Promise<boolean> {
  // The hash names the sockets. The server never kept the raw token.
  const tokenHash = await storage.apiTokens.delete(tokenId, userId);
  if (tokenHash === null) return false;
  revocations.revoke({ userId, onlyTokenHash: tokenHash });
  return true;
}
