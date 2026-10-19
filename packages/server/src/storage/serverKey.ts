import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ServerConfig } from "#/config.ts";
import { logger } from "#/lib/logger.ts";
import {
  AT_REST_COLUMNS,
  atRest,
  newServerKey,
  parseServerKey,
  type ServerKeys,
} from "./atRest.ts";
import type { StorageDriver } from "./types.ts";

/** What the code asks of the file system. Thus, a test can replace it. */
export interface KeyFiles {
  exists(path: string): boolean;
  read(path: string): string;
  /** Writes a new file that only its owner can read. Throws if it exists. */
  create(path: string, content: string): void;
}

const DISK: KeyFiles = {
  exists: existsSync,
  read: (path) => readFileSync(path, "utf8"),
  create(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { mode: 0o600, flag: "wx" });
  },
};

type KeyConfig = Pick<
  ServerConfig,
  | "dataDir"
  | "dbPath"
  | "storageDriver"
  | "backup"
  | "dataEncryptionKey"
  | "dataEncryptionKeyPrevious"
  | "dataKeyFile"
>;

function keyFrom(text: string, name: string): Buffer {
  const key = parseServerKey(text);
  if (!key) {
    throw new Error(
      `${name} must be 32 random bytes, in base64 or hex (for one: openssl rand -base64 32)`,
    );
  }
  return key;
}

/**
 * The server key with which this process stores: that of the operator
 * (`DATA_ENCRYPTION_KEY`), or a key kept in a key file, made at the first
 * start. It tells where the file is, and that you must make a backup of it
 * separately from the database. It shows a warning when the file is next to the
 * database or its backups, where a copy of one would contain the other.
 */
export function loadServerKeys(
  cfg: KeyConfig,
  files: KeyFiles = DISK,
): ServerKeys {
  const previous = cfg.dataEncryptionKeyPrevious
    ? keyFrom(cfg.dataEncryptionKeyPrevious, "DATA_ENCRYPTION_KEY_PREVIOUS")
    : null;
  if (cfg.dataEncryptionKey) {
    return {
      current: keyFrom(cfg.dataEncryptionKey, "DATA_ENCRYPTION_KEY"),
      previous,
    };
  }
  // Nothing stays after a database in memory. Thus, its key also does not stay.
  if (cfg.dataDir === ":memory:" && cfg.dataKeyFile === null) {
    return { current: keyFrom(newServerKey(), "the key"), previous };
  }
  const path = resolve(cfg.dataKeyFile ?? `${cfg.dataDir}/server.key`);
  if (files.exists(path)) {
    const current = keyFrom(files.read(path), `The key file ${path}`);
    warnIfBeside(cfg, path);
    return { current, previous };
  }
  const made = newServerKey();
  files.create(path, `${made}\n`);
  logger.warn(
    "Made a server key. Back this file up, apart from the database: without it reminder times, webhooks and authenticator set-ups cannot be read. No note depends on it.",
    { keyFile: path },
  );
  warnIfBeside(cfg, path);
  return { current: keyFrom(made, "the key"), previous };
}

function warnIfBeside(cfg: KeyConfig, keyFile: string): void {
  const beside: string[] = [];
  const dir = dirname(keyFile);
  if (cfg.storageDriver === "sqlite" && dirname(resolve(cfg.dbPath)) === dir) {
    beside.push("the database");
  }
  if (cfg.backup && resolve(cfg.backup.dir) === dir) beside.push("its backups");
  if (beside.length === 0) return;
  logger.warn(
    `The server key file is in the same directory as ${beside.join(" and ")}: a copy of that directory carries the key with it. Set DATA_KEY_FILE to keep it elsewhere, or supply the key as DATA_ENCRYPTION_KEY.`,
    { keyFile },
  );
}

/**
 * Writes again each value that is not under the current server key: a value
 * from before the server had a key, or a value under the previous key. Runs at
 * start-up. It tells when nothing is under the previous key. Then you can
 * remove `DATA_ENCRYPTION_KEY_PREVIOUS`.
 */
export async function moveToCurrentKey(
  storage: StorageDriver,
  hasPrevious: boolean,
): Promise<number> {
  let moved = 0;
  let left = 0;
  for (const { table, keys, column, purpose } of AT_REST_COLUMNS) {
    moved += await storage.maintenance.rewriteColumn(
      table,
      keys,
      column,
      (stored) => {
        const next = atRest.moved(stored, purpose);
        // Under a key that this server did not get: kept as it is, and counted.
        if (next === null && atRest.open(stored, purpose) === null) left++;
        return next;
      },
    );
  }
  if (moved > 0) {
    logger.info("Moved stored values under the current server key", { moved });
  }
  if (left > 0) {
    logger.error(
      "Some stored values are under a server key this server was not given, and cannot be read. Supply that key as DATA_ENCRYPTION_KEY_PREVIOUS.",
      { values: left },
    );
  } else if (hasPrevious) {
    logger.info(
      "Nothing is left under the previous server key: DATA_ENCRYPTION_KEY_PREVIOUS can be removed.",
    );
  }
  return moved;
}
