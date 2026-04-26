import type { DB } from "../db/index.js";
import type { Broadcaster } from "../ws/broadcaster.js";
import { logger } from "./logger.js";
import { isoMinusDays } from "./time.js";

const HOUR_MS = 60 * 60 * 1000;

interface ExpiredRow {
  id: string;
  user_id: string;
}

/**
 * Hard-deletes trashed notes whose trashed_at is older than 30 days. Runs
 * once on startup, then every hour. Broadcasts note:deleted to each affected
 * user's connected clients so their UI drops the row.
 */
export function startTrashCleanup(
  db: DB,
  broadcaster: Broadcaster,
  intervalMs: number = HOUR_MS,
): () => void {
  const findExpired = db.prepare(
    `SELECT id, user_id FROM notes
       WHERE trashed = 1
         AND trashed_at IS NOT NULL
         AND trashed_at < ?`,
  );
  const deleteOne = db.prepare(`DELETE FROM notes WHERE id = ?`);

  function run() {
    try {
      const cutoff = isoMinusDays(30);
      const rows = findExpired.all(cutoff) as ExpiredRow[];
      if (rows.length === 0) return;
      const tx = db.transaction((batch: ExpiredRow[]) => {
        for (const row of batch) deleteOne.run(row.id);
      });
      tx(rows);
      logger.info("trash cleanup pruned notes", { count: rows.length });
      for (const row of rows) {
        broadcaster.emit(row.user_id, { type: "note:deleted", id: row.id });
      }
    } catch (err) {
      logger.error("trash cleanup failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  run();
  const handle = setInterval(run, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  return () => clearInterval(handle);
}
