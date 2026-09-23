import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { BackupConfig } from "../config.js";
import type { StorageDriver } from "../storage/types.js";
import { logger } from "./logger.js";
import { startPeriodicJob } from "./periodic.js";

const HOUR_MS = 60 * 60 * 1000;
const NAME = /^manifesto-\d{8}-\d{6}\.db$/;

/** `manifesto-20260923-101500.db`, which sorts by time as text. */
export function backupName(at: Date): string {
  const iso = at.toISOString();
  return `manifesto-${iso.slice(0, 10).replaceAll("-", "")}-${iso
    .slice(11, 19)
    .replaceAll(":", "")}.db`;
}

/**
 * Takes one backup into `dir` and deletes all but the newest `keep`. The
 * copy is written under a temporary name and renamed when it is whole, so a
 * crash mid-copy never leaves something that looks like a backup, and the
 * pruning only ever counts finished ones.
 */
export async function takeBackup(
  storage: StorageDriver,
  { dir, keep }: Pick<BackupConfig, "dir" | "keep">,
  now: Date = new Date(),
): Promise<string> {
  if (!storage.backup) throw new Error("This storage driver takes no backups");
  await mkdir(dir, { recursive: true });
  const name = backupName(now);
  const partial = join(dir, `${name}.partial`);
  await storage.backup(partial);
  await rename(partial, join(dir, name));
  const backups = (await readdir(dir)).filter((f) => NAME.test(f)).sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
    await rm(join(dir, old));
  }
  return name;
}

/**
 * `BACKUP_INTERVAL_HOURS`: a backup of the SQLite database every so often,
 * the first one at startup, keeping `BACKUP_KEEP`. Under Postgres it says at
 * boot that it will not, and does nothing.
 */
export function startScheduledBackup(
  storage: StorageDriver,
  cfg: BackupConfig,
): () => void {
  if (!storage.backup) {
    logger.warn(
      "BACKUP_INTERVAL_HOURS is set, but only the SQLite driver takes backups; use pg_dump or the database's own for Postgres",
    );
    return () => {};
  }
  return startPeriodicJob(
    "scheduled backup",
    cfg.intervalHours * HOUR_MS,
    async () => {
      const name = await takeBackup(storage, cfg);
      logger.info("Backup taken", { file: join(cfg.dir, name) });
    },
  );
}
