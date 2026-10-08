import type { AuditRepo, MaintenanceRepo } from "./repos/maintenance.js";
import type {
  AttachmentsRepo,
  NotesRepo,
  VersionsRepo,
  YjsStore,
} from "./repos/notes.js";
import type {
  CommentsRepo,
  PublicLinksRepo,
  SharesRepo,
  TeamsRepo,
} from "./repos/sharing.js";
import type {
  MailedLinksRepo,
  PasskeysRepo,
  TwoFactorRepo,
} from "./repos/signIn.js";
import type { ApiTokensRepo, OAuthRepo } from "./repos/tokens.js";
import type { PrefsRepo, SessionsRepo, UsersRepo } from "./repos/users.js";
import type { WebhooksRepo } from "./repos/webhooks.js";

export * from "./repos/maintenance.js";
export * from "./repos/notes.js";
export * from "./repos/sharing.js";
export * from "./repos/signIn.js";
export * from "./repos/tokens.js";
// The storage driver and the repositories it bundles. Each repository's
// interface lives in `repos/`, re-exported here so callers import one module.
export * from "./repos/users.js";
export * from "./repos/webhooks.js";

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
  twoFactor: TwoFactorRepo;
  passkeys: PasskeysRepo;
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
