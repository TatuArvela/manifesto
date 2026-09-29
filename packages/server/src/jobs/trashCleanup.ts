import { TRASH_RETENTION_DAYS } from "@manifesto/shared";
import { logger } from "../lib/logger.js";
import { startPeriodicJob } from "../lib/periodic.js";
import { isoMinusDays } from "../lib/time.js";
import type { NoteEvents } from "../sharing/noteEvents.js";
import type { StorageDriver } from "../storage/types.js";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Hard-deletes trashed notes whose trashed_at is older than
 * `TRASH_RETENTION_DAYS`. Runs once on startup, then every hour. Each owner's
 * connected clients are told, so their UI drops the row.
 *
 * A note shared with someone who put it in their own trash expires for them
 * the same way: their share is removed, and the note stays with everyone else.
 * `noteEvents` tells them and the note's other participants.
 */
export function startTrashCleanup(deps: {
  storage: StorageDriver;
  noteEvents: NoteEvents;
  intervalMs?: number;
}): () => void {
  const { storage, noteEvents, intervalMs = HOUR_MS } = deps;
  return startPeriodicJob("trash cleanup", intervalMs, async () => {
    const cutoff = isoMinusDays(TRASH_RETENTION_DAYS);
    const removed = await storage.maintenance.cleanupTrashedBefore(cutoff);
    if (removed.length > 0) {
      logger.info("trash cleanup pruned notes", { count: removed.length });
      for (const row of removed) {
        // Trashed, the note had already left everyone it was shared with.
        noteEvents.deleted(row.id, row.userId, []);
      }
    }
    const left = await storage.maintenance.cleanupTrashedSharesBefore(cutoff);
    if (left.length === 0) return;
    logger.info("trash cleanup pruned shares", { count: left.length });
    noteEvents.ended(left);
    for (const noteId of new Set(left.map((share) => share.noteId))) {
      await noteEvents.changed(noteId);
    }
  });
}
