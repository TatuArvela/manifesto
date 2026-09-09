import type { StorageDriver } from "../storage/types.js";
import type { Broadcaster } from "../ws/broadcaster.js";
import { logger } from "./logger.js";
import { startPeriodicJob } from "./periodic.js";
import { isoMinusDays } from "./time.js";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Hard-deletes trashed notes whose trashed_at is older than 30 days. Runs
 * once on startup, then every hour. Broadcasts note:deleted to each affected
 * user's connected clients so their UI drops the row.
 */
export function startTrashCleanup(
  storage: StorageDriver,
  broadcaster: Broadcaster,
  intervalMs: number = HOUR_MS,
): () => void {
  return startPeriodicJob("trash cleanup", intervalMs, async () => {
    const cutoff = isoMinusDays(30);
    const removed = await storage.maintenance.cleanupTrashedBefore(cutoff);
    if (removed.length === 0) return;
    logger.info("trash cleanup pruned notes", { count: removed.length });
    for (const row of removed) {
      broadcaster.emit(row.userId, { type: "note:deleted", id: row.id });
    }
  });
}
