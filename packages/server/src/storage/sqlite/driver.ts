import type { ServerConfig } from "../../config.js";
import type { StorageDriver } from "../types.js";
import { createSqliteApiTokensRepo } from "./apiTokensRepo.js";
import { createSqliteAttachmentsRepo } from "./attachmentsRepo.js";
import { createSqliteAuditRepo } from "./auditRepo.js";
import { createSqliteCommentsRepo } from "./commentsRepo.js";
import { openDatabase, type SqliteDB } from "./database.js";
import { createSqliteMailedLinksRepo } from "./mailedLinksRepo.js";
import { createSqliteMaintenanceRepo } from "./maintenanceRepo.js";
import { createSqliteNotesRepo } from "./notesRepo.js";
import { createSqliteOAuthRepo } from "./oauthRepo.js";
import { createSqlitePasskeysRepo } from "./passkeysRepo.js";
import { createSqlitePrefsRepo } from "./prefsRepo.js";
import { createSqlitePublicLinksRepo } from "./publicLinksRepo.js";
import { createSqliteSessionsRepo } from "./sessionsRepo.js";
import { createSqliteSharesRepo } from "./sharesRepo.js";
import { createSqliteTeamsRepo } from "./teamsRepo.js";
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
    oauth: createSqliteOAuthRepo(db),
    webhooks: createSqliteWebhooksRepo(db),
    publicLinks: createSqlitePublicLinksRepo(db),
    teams: createSqliteTeamsRepo(db),
    twoFactor: createSqliteTwoFactorRepo(db),
    passkeys: createSqlitePasskeysRepo(db),
    prefs: createSqlitePrefsRepo(db),
    passwordResets: createSqliteMailedLinksRepo(db, "password_resets"),
    signInLinks: createSqliteMailedLinksRepo(db, "sign_in_links"),
    comments: createSqliteCommentsRepo(db),
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
