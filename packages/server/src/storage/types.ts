import type { AuditRepo, MaintenanceRepo } from "./repos/maintenance.ts";
import type {
  AttachmentsRepo,
  NotesRepo,
  VersionsRepo,
  YjsStore,
} from "./repos/notes.ts";
import type { PushSubscriptionsRepo, ServerSecretsRepo } from "./repos/push.ts";
import type {
  CommentsRepo,
  PublicLinksRepo,
  SharesRepo,
  TeamsRepo,
} from "./repos/sharing.ts";
import type {
  AccountKeysRepo,
  MailedLinksRepo,
  PasskeysRepo,
  TwoFactorRepo,
} from "./repos/signIn.ts";
import type { ApiTokensRepo, OAuthRepo } from "./repos/tokens.ts";
import type { PrefsRepo, SessionsRepo, UsersRepo } from "./repos/users.ts";
import type { WebhooksRepo } from "./repos/webhooks.ts";

export * from "./repos/maintenance.ts";
export * from "./repos/notes.ts";
export * from "./repos/push.ts";
export * from "./repos/sharing.ts";
export * from "./repos/signIn.ts";
export * from "./repos/tokens.ts";
// The storage driver and the repositories it bundles. Each repository's
// interface lives in `repos/`, re-exported here so callers import one module.
export * from "./repos/users.ts";
export * from "./repos/webhooks.ts";

export interface StorageDriver {
  users: UsersRepo;
  sessions: SessionsRepo;
  notes: NotesRepo;
  shares: SharesRepo;
  yjs: YjsStore;
  maintenance: MaintenanceRepo;
  attachments: AttachmentsRepo;
  versions: VersionsRepo;
  apiTokens: ApiTokensRepo;
  oauth: OAuthRepo;
  webhooks: WebhooksRepo;
  pushSubscriptions: PushSubscriptionsRepo;
  serverSecrets: ServerSecretsRepo;
  twoFactor: TwoFactorRepo;
  passkeys: PasskeysRepo;
  accountKeys: AccountKeysRepo;
  passwordResets: MailedLinksRepo;
  signInLinks: MailedLinksRepo;
  comments: CommentsRepo;
  audit: AuditRepo;
  prefs: PrefsRepo;
  publicLinks: PublicLinksRepo;
  teams: TeamsRepo;
  /**
   * A consistent copy of the whole database at `path`, taken while it keeps
   * serving. SQLite only; Postgres has `pg_dump` and managed backups.
   */
  backup?(path: string): Promise<void>;
  close(): Promise<void>;
}
