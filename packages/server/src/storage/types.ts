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
// The storage driver and its repositories. The interface of each repository is
// in `repos/`, and this file exports them again. Thus, callers import one
// module.
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
  /** Not mailed: shown as a QR code to a second device. The same shape. */
  deviceLinks: MailedLinksRepo;
  comments: CommentsRepo;
  audit: AuditRepo;
  prefs: PrefsRepo;
  publicLinks: PublicLinksRepo;
  teams: TeamsRepo;
  /**
   * A consistent copy of the full database at `path`, made while it continues
   * to serve. Only SQLite. Postgres has `pg_dump` and managed backups.
   */
  backup?(path: string): Promise<void>;
  close(): Promise<void>;
}
