import type { ServerConfig } from "../config.js";
import { createSqliteStorage } from "./sqlite/driver.js";
import type { StorageDriver } from "./types.js";

export type StorageDriverName = "sqlite";

export function createStorage(cfg: ServerConfig): StorageDriver {
  switch (cfg.storageDriver) {
    case "sqlite":
      return createSqliteStorage(cfg);
    default: {
      const exhaustive: never = cfg.storageDriver;
      throw new Error(`Unknown storage driver: ${String(exhaustive)}`);
    }
  }
}

export type { StorageDriver } from "./types.js";
