import type { PostgresConfig } from "../../config.js";
import type { StorageDriver } from "../types.js";
import {
  openPostgres,
  type PgPool,
  type PostgresOpenOptions,
} from "./database.js";
import { createPostgresMaintenanceRepo } from "./maintenanceRepo.js";
import { runMigrations } from "./migrations.js";
import { createPostgresNotesRepo } from "./notesRepo.js";
import { createPostgresSessionsRepo } from "./sessionsRepo.js";
import { createPostgresUsersRepo } from "./usersRepo.js";
import { createPostgresYjsStore } from "./yjsStore.js";

export interface PostgresStorageDriver extends StorageDriver {
  readonly pool: PgPool;
}

export interface CreatePostgresStorageOptions {
  poolFactory?: PostgresOpenOptions["poolFactory"];
  // Skip migrations — useful for tests that pre-seeded the schema (e.g. via
  // pg-mem) before the storage is constructed.
  skipMigrations?: boolean;
}

export async function createPostgresStorage(
  cfg: PostgresConfig,
  options: CreatePostgresStorageOptions = {},
): Promise<PostgresStorageDriver> {
  const pool = openPostgres({
    connectionString: cfg.connectionString,
    poolFactory: options.poolFactory,
  });
  if (!options.skipMigrations) {
    await runMigrations(pool);
  }
  return {
    pool,
    users: createPostgresUsersRepo(pool),
    sessions: createPostgresSessionsRepo(pool),
    notes: createPostgresNotesRepo(pool),
    yjs: createPostgresYjsStore(pool),
    maintenance: createPostgresMaintenanceRepo(pool),
    async close() {
      await pool.end();
    },
  };
}
