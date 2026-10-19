import { NOTE_VERSION_MAX_AGE_DAYS } from "@manifesto/shared";
import { logger } from "#/lib/logger.ts";
import { startPeriodicJob } from "#/lib/periodic.ts";
import { nowIso } from "#/lib/time.ts";
import type { StorageDriver } from "#/storage/types.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long the server keeps an image to which no note refers. The version
 * history of a client refers to attachments by id, and keeps versions for 90
 * days. Thus, a version that you restore within that time still finds its
 * images.
 */
export const ATTACHMENT_GRACE_DAYS = NOTE_VERSION_MAX_AGE_DAYS;

/**
 * Deletes attachments to which no note referred for `ATTACHMENT_GRACE_DAYS`.
 * Runs one time at startup, and then each hour.
 */
export function startAttachmentCleanup(
  storage: StorageDriver,
  intervalMs: number = HOUR_MS,
): () => void {
  return startPeriodicJob("attachment cleanup", intervalMs, async () => {
    const now = nowIso();
    const cutoff = new Date(
      Date.parse(now) - ATTACHMENT_GRACE_DAYS * DAY_MS,
    ).toISOString();
    const removed = await storage.attachments.sweep(now, cutoff);
    if (removed > 0) {
      logger.info("attachment cleanup removed attachments", { count: removed });
    }
  });
}
