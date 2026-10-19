import { logger } from "#/lib/logger.ts";
import { startPeriodicJob } from "#/lib/periodic.ts";
import { isoMinusDays, nowIso } from "#/lib/time.ts";
import { UNUSED_CLIENT_DAYS } from "#/oauth/grants.ts";
import type { StorageDriver } from "#/storage/types.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Deletes sessions whose `expires_at` is past. Runs one time at startup, and
 * then each hour.
 *
 * Authentication already refuses expired sessions. Thus, this is about the
 * rows, not about access. Without it, the table grows without limit, and hashes
 * of tokens that will never be valid again stay in the database forever. The
 * inactivity timeout and the absolute lifetime both go into `expires_at` (see
 * `auth/session.ts`). Thus, this one sweep covers both.
 */
export function startSessionCleanup(deps: {
  storage: StorageDriver;
  auditRetentionDays: number;
  intervalMs?: number;
}): () => void {
  const { storage, auditRetentionDays, intervalMs = HOUR_MS } = deps;
  return startPeriodicJob("session cleanup", intervalMs, async () => {
    const now = nowIso();
    const removed = await storage.sessions.deleteExpired(now);
    if (removed > 0) {
      logger.info("session cleanup pruned sessions", { count: removed });
    }
    await storage.passwordResets.deleteExpired(now);
    await storage.signInLinks.deleteExpired(now);
    await storage.audit.deleteBefore(
      new Date(Date.parse(now) - auditRetentionDays * DAY_MS).toISOString(),
    );
    // The server already refuses expired API tokens. This is about the rows.
    const tokens = await storage.apiTokens.deleteExpired(now);
    if (tokens > 0) {
      logger.info("session cleanup pruned API tokens", { count: tokens });
    }
    // A code is good for minutes. A client that registered and never got access
    // is an abandoned attempt, or a person who fills the table.
    await storage.oauth.deleteExpiredCodes(now);
    await storage.oauth.deleteUnusedClients(isoMinusDays(UNUSED_CLIENT_DAYS));
  });
}
