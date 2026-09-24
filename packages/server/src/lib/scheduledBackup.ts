import { mkdir, readdir, rename, rm, stat, statfs } from "node:fs/promises";
import { join } from "node:path";
import type { BackupConfig } from "../config.js";
import type { StorageDriver } from "../storage/types.js";
import { logger } from "./logger.js";
import { startPeriodicJob } from "./periodic.js";

const HOUR_MS = 60 * 60 * 1000;
const NAME = /^manifesto-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/;
const PARTIAL = /^manifesto-\d{8}-\d{6}\.db\.partial$/;

/**
 * Free space to leave on the backup volume after a copy. A backup is a
 * convenience; the database it copies has to keep being able to write.
 */
export const BACKUP_FREE_RESERVE_BYTES = 256 * 1024 * 1024;

/**
 * A run this soon after the last finished backup is skipped, as a fraction of
 * the interval: a restart (or a crash loop) does not copy the database again,
 * while a scheduled run whose timer fired a little early still goes ahead.
 */
const RECENT_FRACTION = 0.9;

/** `manifesto-20260923-101500.db`, which sorts by time as text. */
export function backupName(at: Date): string {
  const iso = at.toISOString();
  return `manifesto-${iso.slice(0, 10).replaceAll("-", "")}-${iso
    .slice(11, 19)
    .replaceAll(":", "")}.db`;
}

/** When a backup file was taken, from its name; null for any other file. */
export function backupTime(name: string): number | null {
  const m = NAME.exec(name);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

export interface BackupEnvironment {
  /** Bytes free on the backup volume. */
  freeBytes: (dir: string) => Promise<number>;
  /** Bytes the copy will take: the database file and its WAL. */
  databaseBytes: () => Promise<number>;
}

export type BackupOutcome =
  | { kind: "taken"; name: string }
  | { kind: "skipped"; reason: "recent"; latest: string };

/**
 * One scheduled run: clears copies a crash left half-written, skips when the
 * newest finished backup is recent, refuses when the volume lacks room for
 * the copy and the reserve, and otherwise takes a backup and deletes all but
 * the newest `keep`.
 *
 * The copy is written under a temporary name and renamed when it is whole, so
 * a crash mid-copy never leaves something that looks like a backup; the next
 * run deletes what it left.
 */
export async function takeBackup(
  storage: StorageDriver,
  cfg: Pick<BackupConfig, "dir" | "keep" | "intervalHours">,
  env: BackupEnvironment,
  now: Date = new Date(),
): Promise<BackupOutcome> {
  if (!storage.backup) throw new Error("This storage driver takes no backups");
  const { dir, keep } = cfg;
  await mkdir(dir, { recursive: true });

  const files = await readdir(dir);
  for (const leftover of files.filter((f) => PARTIAL.test(f))) {
    await rm(join(dir, leftover), { force: true });
  }

  const finished = files.filter((f) => backupTime(f) !== null).sort();
  const latest = finished.at(-1);
  if (latest) {
    const age = now.getTime() - (backupTime(latest) as number);
    if (age >= 0 && age < cfg.intervalHours * HOUR_MS * RECENT_FRACTION) {
      return { kind: "skipped", reason: "recent", latest };
    }
  }

  const needed = (await env.databaseBytes()) + BACKUP_FREE_RESERVE_BYTES;
  const free = await env.freeBytes(dir);
  if (free < needed) {
    const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;
    throw new Error(
      `Not enough free space for a backup: ${mb(free)} free, ${mb(needed)} needed (the database and a ${mb(BACKUP_FREE_RESERVE_BYTES)} reserve)`,
    );
  }

  const name = backupName(now);
  const partial = join(dir, `${name}.partial`);
  await storage.backup(partial);
  await rename(partial, join(dir, name));
  const backups = [...finished, name].sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
    await rm(join(dir, old), { force: true });
  }
  return { kind: "taken", name };
}

/** The real volume and database, for `takeBackup`. */
export function fileSystemEnvironment(dbPath: string): BackupEnvironment {
  const sizeOf = async (path: string) => {
    try {
      return (await stat(path)).size;
    } catch {
      return 0;
    }
  };
  return {
    async freeBytes(dir) {
      const fs = await statfs(dir);
      return fs.bavail * fs.bsize;
    },
    async databaseBytes() {
      return (await sizeOf(dbPath)) + (await sizeOf(`${dbPath}-wal`));
    },
  };
}

/**
 * `BACKUP_INTERVAL_HOURS`: a backup of the SQLite database every so often,
 * checked at startup too (and skipped then if the last one is recent),
 * keeping `BACKUP_KEEP`. A refused run fails the job, which the admin
 * overview and the metrics show. Under Postgres it says at boot that it will
 * not, and does nothing.
 */
export function startScheduledBackup(
  storage: StorageDriver,
  cfg: BackupConfig,
  dbPath: string,
): () => void {
  if (!storage.backup) {
    logger.warn(
      "BACKUP_INTERVAL_HOURS is set, but only the SQLite driver takes backups; use pg_dump or the database's own for Postgres",
    );
    return () => {};
  }
  const env = fileSystemEnvironment(dbPath);
  return startPeriodicJob(
    "scheduled backup",
    cfg.intervalHours * HOUR_MS,
    async () => {
      const outcome = await takeBackup(storage, cfg, env);
      if (outcome.kind === "taken") {
        logger.info("Backup taken", { file: join(cfg.dir, outcome.name) });
      } else {
        logger.info("Backup skipped: the last one is recent", {
          latest: outcome.latest,
        });
      }
    },
  );
}
