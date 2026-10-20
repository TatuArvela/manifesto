import type { PostgresConfig } from "#/config.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { createPostgresAccountKeysRepo } from "./accountKeysRepo.ts";
import { createPostgresApiTokensRepo } from "./apiTokensRepo.ts";
import { createPostgresAttachmentsRepo } from "./attachmentsRepo.ts";
import { createPostgresAuditRepo } from "./auditRepo.ts";
import { createPostgresCommentsRepo } from "./commentsRepo.ts";
import {
  openPostgres,
  type PgPool,
  type PostgresOpenOptions,
} from "./database.ts";
import { createPostgresMailedLinksRepo } from "./mailedLinksRepo.ts";
import { createPostgresMaintenanceRepo } from "./maintenanceRepo.ts";
import { runMigrations } from "./migrations.ts";
import { createPostgresNotesRepo } from "./notesRepo.ts";
import { createPostgresOAuthRepo } from "./oauthRepo.ts";
import { createPostgresPasskeysRepo } from "./passkeysRepo.ts";
import { createPostgresPrefsRepo } from "./prefsRepo.ts";
import { createPostgresPublicLinksRepo } from "./publicLinksRepo.ts";
import {
  createPostgresPushSubscriptionsRepo,
  createPostgresServerSecretsRepo,
} from "./pushRepo.ts";
import { createPostgresSessionsRepo } from "./sessionsRepo.ts";
import { createPostgresSharesRepo } from "./sharesRepo.ts";
import { createPostgresTeamsRepo } from "./teamsRepo.ts";
import { createPostgresTwoFactorRepo } from "./twoFactorRepo.ts";
import { createPostgresUsersRepo } from "./usersRepo.ts";
import { createPostgresVersionsRepo } from "./versionsRepo.ts";
import { createPostgresWebhooksRepo } from "./webhooksRepo.ts";
import { createPostgresYjsStore } from "./yjsStore.ts";

export interface PostgresStorageDriver extends StorageDriver {
  readonly pool: PgPool;
}

export interface CreatePostgresStorageOptions {
  poolFactory?: PostgresOpenOptions["poolFactory"];
  // Skip migrations. This is useful for tests that seeded the schema before the
  // storage is made.
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
    shares: createPostgresSharesRepo(pool),
    yjs: createPostgresYjsStore(pool),
    attachments: createPostgresAttachmentsRepo(pool),
    versions: createPostgresVersionsRepo(pool),
    apiTokens: createPostgresApiTokensRepo(pool),
    oauth: createPostgresOAuthRepo(pool),
    webhooks: createPostgresWebhooksRepo(pool),
    pushSubscriptions: createPostgresPushSubscriptionsRepo(pool),
    serverSecrets: createPostgresServerSecretsRepo(pool),
    publicLinks: createPostgresPublicLinksRepo(pool),
    teams: createPostgresTeamsRepo(pool),
    twoFactor: createPostgresTwoFactorRepo(pool),
    passkeys: createPostgresPasskeysRepo(pool),
    accountKeys: createPostgresAccountKeysRepo(pool),
    prefs: createPostgresPrefsRepo(pool),
    passwordResets: createPostgresMailedLinksRepo(pool, "password_resets"),
    signInLinks: createPostgresMailedLinksRepo(pool, "sign_in_links"),
    comments: createPostgresCommentsRepo(pool),
    audit: createPostgresAuditRepo(pool),
    maintenance: createPostgresMaintenanceRepo(pool),
    async close() {
      await pool.end();
    },
  };
}
