import type { PostgresConfig } from "../../config.js";
import type { StorageDriver } from "../types.js";
import { createPostgresApiTokensRepo } from "./apiTokensRepo.js";
import { createPostgresAttachmentsRepo } from "./attachmentsRepo.js";
import { createPostgresAuditRepo } from "./auditRepo.js";
import {
  openPostgres,
  type PgPool,
  type PostgresOpenOptions,
} from "./database.js";
import { createPostgresMaintenanceRepo } from "./maintenanceRepo.js";
import { runMigrations } from "./migrations.js";
import { createPostgresNotesRepo, reindexStaleNotes } from "./notesRepo.js";
import { createPostgresPasswordResetsRepo } from "./passwordResetsRepo.js";
import { createPostgresSessionsRepo } from "./sessionsRepo.js";
import { createPostgresSharesRepo } from "./sharesRepo.js";
import { createPostgresTwoFactorRepo } from "./twoFactorRepo.js";
import { createPostgresUsersRepo } from "./usersRepo.js";
import { createPostgresVersionsRepo } from "./versionsRepo.js";
import { createPostgresWebhooksRepo } from "./webhooksRepo.js";
import { createPostgresYjsStore } from "./yjsStore.js";

export interface PostgresStorageDriver extends StorageDriver {
  readonly pool: PgPool;
}

export interface CreatePostgresStorageOptions {
  poolFactory?: PostgresOpenOptions["poolFactory"];
  // Skip migrations; useful for tests that pre-seeded the schema (e.g. via
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
    await reindexStaleNotes(pool);
  }
  return {
    pool,
    users: createPostgresUsersRepo(pool),
    sessions: createPostgresSessionsRepo(pool),
    notes: createPostgresNotesRepo(pool),
    shares: createPostgresSharesRepo(pool),
    yjs: createPostgresYjsStore(pool),
    attachments: createPostgresAttachmentsRepo(pool),
    versions: createPostgresVersionsRepo(pool),
    apiTokens: createPostgresApiTokensRepo(pool),
    webhooks: createPostgresWebhooksRepo(pool),
    twoFactor: createPostgresTwoFactorRepo(pool),
    passwordResets: createPostgresPasswordResetsRepo(pool),
    audit: createPostgresAuditRepo(pool),
    maintenance: createPostgresMaintenanceRepo(pool),
    async close() {
      await pool.end();
    },
  };
}
