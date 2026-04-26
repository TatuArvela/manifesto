import type { StorageDriver } from "../storage/types.js";
import type { Broadcaster } from "../ws/broadcaster.js";
import { logger } from "./logger.js";
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
  async function run() {
    try {
      const cutoff = isoMinusDays(30);
      const removed = await storage.maintenance.cleanupTrashedBefore(cutoff);
      if (removed.length === 0) return;
      logger.info("trash cleanup pruned notes", { count: removed.length });
      for (const row of removed) {
        broadcaster.emit(row.userId, { type: "note:deleted", id: row.id });
      }
    } catch (err) {
      logger.error("trash cleanup failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  void run();
  const handle = setInterval(() => {
    void run();
  }, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  return () => clearInterval(handle);
}
