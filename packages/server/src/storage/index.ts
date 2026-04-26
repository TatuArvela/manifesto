import type { ServerConfig } from "../config.js";
import { createPostgresStorage } from "./postgres/driver.js";
import { createSqliteStorage } from "./sqlite/driver.js";
import type { StorageDriver } from "./types.js";

export async function createStorage(cfg: ServerConfig): Promise<StorageDriver> {
  switch (cfg.storageDriver) {
    case "sqlite":
      return createSqliteStorage(cfg);
    case "postgres": {
      if (!cfg.postgres) {
        throw new Error(
          "Postgres config missing — set DATABASE_URL when STORAGE_DRIVER=postgres",
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
