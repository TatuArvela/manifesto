import type { ServerConfig } from "#/config.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { createSqliteAccountKeysRepo } from "./accountKeysRepo.ts";
import { createSqliteApiTokensRepo } from "./apiTokensRepo.ts";
import { createSqliteAttachmentsRepo } from "./attachmentsRepo.ts";
import { createSqliteAuditRepo } from "./auditRepo.ts";
import { createSqliteCommentsRepo } from "./commentsRepo.ts";
import { openDatabase, type SqliteDB } from "./database.ts";
import { createSqliteDeviceSignInsRepo } from "./deviceSignInsRepo.ts";
import { createSqliteMailedLinksRepo } from "./mailedLinksRepo.ts";
import { createSqliteMaintenanceRepo } from "./maintenanceRepo.ts";
import { createSqliteNotesRepo } from "./notesRepo.ts";
import { createSqliteOAuthRepo } from "./oauthRepo.ts";
import { createSqlitePasskeysRepo } from "./passkeysRepo.ts";
import { createSqlitePrefsRepo } from "./prefsRepo.ts";
import { createSqlitePublicLinksRepo } from "./publicLinksRepo.ts";
import {
  createSqlitePushSubscriptionsRepo,
  createSqliteServerSecretsRepo,
} from "./pushRepo.ts";
import { createSqliteSessionsRepo } from "./sessionsRepo.ts";
import { createSqliteSharesRepo } from "./sharesRepo.ts";
import { createSqliteTeamsRepo } from "./teamsRepo.ts";
import { createSqliteTwoFactorRepo } from "./twoFactorRepo.ts";
import { createSqliteUsersRepo } from "./usersRepo.ts";
import { createSqliteVersionsRepo } from "./versionsRepo.ts";
import { createSqliteWebhooksRepo } from "./webhooksRepo.ts";
import { createSqliteYjsStore } from "./yjsStore.ts";

export interface SqliteStorageDriver extends StorageDriver {
  // Exposed for tests that need direct database access (for example, to check
  // stored Yjs blobs). Production code must go through the typed repos.
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
    pushSubscriptions: createSqlitePushSubscriptionsRepo(db),
    serverSecrets: createSqliteServerSecretsRepo(db),
    publicLinks: createSqlitePublicLinksRepo(db),
    teams: createSqliteTeamsRepo(db),
    twoFactor: createSqliteTwoFactorRepo(db),
    passkeys: createSqlitePasskeysRepo(db),
    accountKeys: createSqliteAccountKeysRepo(db),
    prefs: createSqlitePrefsRepo(db),
    passwordResets: createSqliteMailedLinksRepo(db, "password_resets"),
    signInLinks: createSqliteMailedLinksRepo(db, "sign_in_links"),
    deviceSignIns: createSqliteDeviceSignInsRepo(db),
    comments: createSqliteCommentsRepo(db),
    audit: createSqliteAuditRepo(db),
    maintenance: createSqliteMaintenanceRepo(db),
    async backup(path) {
      // The online backup API of SQLite: consistent, with the WAL, and writes
      // can continue while it copies.
      await db.backup(path);
    },
    async close() {
      db.close();
    },
  };
}
