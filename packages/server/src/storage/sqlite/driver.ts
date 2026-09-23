import type { ServerConfig } from "../../config.js";
import type { StorageDriver } from "../types.js";
import { createSqliteApiTokensRepo } from "./apiTokensRepo.js";
import { createSqliteAttachmentsRepo } from "./attachmentsRepo.js";
import { createSqliteAuditRepo } from "./auditRepo.js";
import { openDatabase, type SqliteDB } from "./database.js";
import { createSqliteMaintenanceRepo } from "./maintenanceRepo.js";
import { createSqliteNotesRepo } from "./notesRepo.js";
import { createSqlitePasswordResetsRepo } from "./passwordResetsRepo.js";
import { createSqliteSessionsRepo } from "./sessionsRepo.js";
import { createSqliteSharesRepo } from "./sharesRepo.js";
import { createSqliteTwoFactorRepo } from "./twoFactorRepo.js";
import { createSqliteUsersRepo } from "./usersRepo.js";
import { createSqliteVersionsRepo } from "./versionsRepo.js";
import { createSqliteWebhooksRepo } from "./webhooksRepo.js";
import { createSqliteYjsStore } from "./yjsStore.js";

export interface SqliteStorageDriver extends StorageDriver {
  // Exposed for tests that need direct DB access (e.g. asserting persisted
  // Yjs blobs). Production code paths must go through the typed repos.
  readonly db: SqliteDB;
}

export function createSqliteStorage(
  cfg: Pick<ServerConfig, "dbPath">,
): SqliteStorageDriver {
  const db = openDatabase(cfg.dbPath);
  return {
    db,
    users: createSqliteUsersRepo(db),
    sessions: createSqliteSessionsRepo(db),
    notes: createSqliteNotesRepo(db),
    shares: createSqliteSharesRepo(db),
    yjs: createSqliteYjsStore(db),
    attachments: createSqliteAttachmentsRepo(db),
    versions: createSqliteVersionsRepo(db),
    apiTokens: createSqliteApiTokensRepo(db),
    webhooks: createSqliteWebhooksRepo(db),
    twoFactor: createSqliteTwoFactorRepo(db),
    passwordResets: createSqlitePasswordResetsRepo(db),
    audit: createSqliteAuditRepo(db),
    maintenance: createSqliteMaintenanceRepo(db),
    async backup(path) {
      // SQLite's online backup API: consistent, WAL included, and it lets
      // writes go on while it copies.
      await db.backup(path);
    },
    async close() {
      db.close();
    },
  };
}
