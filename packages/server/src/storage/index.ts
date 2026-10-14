import type { ServerConfig } from "../config.js";
import { createAtRest, useAtRest } from "./atRest.js";
import { createPostgresStorage } from "./postgres/driver.js";
import { loadServerKeys } from "./serverKey.js";
import { createSqliteStorage } from "./sqlite/driver.js";
import type { StorageDriver } from "./types.js";

export async function createStorage(cfg: ServerConfig): Promise<StorageDriver> {
  // Before a driver reads or writes a row: what the server stores for
  // itself goes under its key.
  useAtRest(createAtRest(loadServerKeys(cfg)));
  switch (cfg.storageDriver) {
    case "sqlite":
      return createSqliteStorage(cfg);
    case "postgres": {
      if (!cfg.postgres) {
        throw new Error(
          "Postgres config missing: set DATABASE_URL when STORAGE_DRIVER=postgres",
        );
      }
      return await createPostgresStorage(cfg.postgres);
    }
    default: {
      const exhaustive: never = cfg.storageDriver;
      throw new Error(`Unknown storage driver: ${String(exhaustive)}`);
    }
  }
}

export type { StorageDriver } from "./types.js";
