import type { StorageDriver } from "../storage/types.js";
import { logger } from "./logger.js";
import { startPeriodicJob } from "./periodic.js";
import { nowIso } from "./time.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Deletes sessions whose `expires_at` has passed. Runs once on startup, then
 * every hour.
 *
 * Expired sessions are already refused at authentication time, so this is
 * about the rows rather than about access: without it the table grows without
 * bound, and hashes of tokens that will never be valid again sit in the
 * database forever. Both the inactivity timeout and the absolute lifetime
 * land in `expires_at` (see `auth/session.ts`), so this one sweep covers both.
 */
export function startSessionCleanup(
  storage: StorageDriver,
  intervalMs: number = HOUR_MS,
  auditRetentionDays = 180,
): () => void {
  return startPeriodicJob("session cleanup", intervalMs, async () => {
    const now = nowIso();
    const removed = await storage.sessions.deleteExpired(now);
    if (removed > 0) {
      logger.info("session cleanup pruned sessions", { count: removed });
    }
    await storage.passwordResets.deleteExpired(now);
    await storage.audit.deleteBefore(
      new Date(Date.parse(now) - auditRetentionDays * DAY_MS).toISOString(),
    );
    // Expired API tokens are refused already; this is about the rows.
    const tokens = await storage.apiTokens.deleteExpired(now);
    if (tokens > 0) {
      logger.info("session cleanup pruned API tokens", { count: tokens });
    }
  });
}
