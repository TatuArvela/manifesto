import type { ServerConfig } from "../../config.js";
import type { StorageDriver } from "../types.js";
import { createSqliteAttachmentsRepo } from "./attachmentsRepo.js";
import { openDatabase, type SqliteDB } from "./database.js";
import { createSqliteMaintenanceRepo } from "./maintenanceRepo.js";
import { createSqliteNotesRepo } from "./notesRepo.js";
import { createSqliteSessionsRepo } from "./sessionsRepo.js";
import { createSqliteSharesRepo } from "./sharesRepo.js";
import { createSqliteUsersRepo } from "./usersRepo.js";
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
    maintenance: createSqliteMaintenanceRepo(db),
    async close() {
      db.close();
    },
  };
}
