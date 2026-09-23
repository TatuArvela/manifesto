import { moveInlineImagesToStore } from "../attachments/store.js";
import type { StorageDriver } from "../storage/types.js";
import { logger } from "./logger.js";
import { startPeriodicJob } from "./periodic.js";
import { nowIso } from "./time.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long an image no note refers to is kept. A client's version history
 * refers to attachments by id and keeps versions for 90 days, so a version
 * restored within that window still finds its images.
 */
export const ATTACHMENT_GRACE_DAYS = 90;

/**
 * Deletes attachments no note has referred to for `ATTACHMENT_GRACE_DAYS`.
 * Runs once on startup, then hourly. The first run also moves any image still
 * held inline in a note row, from before the store existed, into it.
 */
export function startAttachmentCleanup(
  storage: StorageDriver,
  intervalMs: number = HOUR_MS,
): () => void {
  let moved = false;
  return startPeriodicJob("attachment cleanup", intervalMs, async () => {
    const now = nowIso();
    if (!moved) {
      const count = await moveInlineImagesToStore(storage, now);
      moved = true;
      if (count > 0) {
        logger.info("moved inline images to the attachment store", {
          notes: count,
        });
      }
    }
    const cutoff = new Date(
      Date.parse(now) - ATTACHMENT_GRACE_DAYS * DAY_MS,
    ).toISOString();
    const removed = await storage.attachments.sweep(now, cutoff);
    if (removed > 0) {
      logger.info("attachment cleanup removed attachments", { count: removed });
    }
  });
}
