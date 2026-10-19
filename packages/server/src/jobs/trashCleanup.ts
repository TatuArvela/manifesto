import { TRASH_RETENTION_DAYS } from "@manifesto/shared";
import { logger } from "#/lib/logger.ts";
import { startPeriodicJob } from "#/lib/periodic.ts";
import { isoMinusDays } from "#/lib/time.ts";
import type { NoteEvents } from "#/sharing/noteEvents.ts";
import type { StorageDriver } from "#/storage/types.ts";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Permanently deletes trashed notes whose trashed_at is older than
 * `TRASH_RETENTION_DAYS`. Runs one time at startup, and then each hour. The
 * connected clients of each owner get a message. Thus, their UI removes the
 * row.
 *
 * A shared note that a recipient put in their own trash expires for them in the
 * same way. Their share is removed, and the note stays with all other persons.
 * `noteEvents` tells them and the other participants of the note.
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
        // In the trash, the note already went away from all persons with whom
        // it was shared.
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
