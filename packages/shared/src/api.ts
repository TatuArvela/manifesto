import type {
  LinkPreview,
  Note,
  NoteColor,
  NoteFont,
  NoteVersion,
  ShareRole,
  ShareUser,
} from "./note.js";

// --- Pagination ---

/**
 * How many notes a list endpoint returns when the caller doesn't say. Large
 * enough that most accounts are one page, small enough that no single response
 * is unbounded.
 */
export const DEFAULT_NOTES_PAGE_SIZE = 200;

/** The most a caller may ask for in one page. */
export const MAX_NOTES_PAGE_SIZE = 500;

export interface PageParams {
  limit?: number;
  /** Opaque: the `nextCursor` of the previous page, and nothing else. */
  cursor?: string;
}

// --- REST responses ---

export interface NotesResponse {
  /**
   * One page of notes, newest first. Attachments are **not** included: a
   * listed note carries `imageCount` and an empty `images`, and the data URLs
   * arrive with `GET /api/notes/:id`. Sending every attachment of every note
   * on every load is what made a list response unbounded in the first place.
   */
  notes: Note[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

export interface NoteResponse {
  note: Note;
}

/** `GET /api/notes/:id/versions`, newest first. */
export interface NoteVersionsResponse {
  versions: NoteVersion[];
}

/**
 * `POST /api/notes/:id/versions`. `timestamp` is for bringing a history kept
 * in a browser across with its own dates; the server stamps one left out.
 */
export interface NoteVersionCreateRequest {
  title: string;
  content: string;
  timestamp?: string;
}

/**
 * A personal API token as listed: never the secret, which is shown once, in
 * the response that created it.
 */
export interface ApiToken {
  id: string;
  name: string;
  /** The secret's first characters, so a user can tell tokens apart. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Null for a token that does not expire. */
  expiresAt: string | null;
}

export interface ApiTokensResponse {
  tokens: ApiToken[];
}

export interface ApiTokenCreateRequest {
  name: string;
  /** Days until it stops working; left out for a token that does not expire. */
  expiresInDays?: number;
}

export interface ApiTokenCreatedResponse {
  token: ApiToken;
  /** The bearer token itself. Shown this once; the server keeps only a hash. */
  secret: string;
}

/** The note events a webhook can be sent. */
export const WEBHOOK_EVENTS = [
  "note.created",
  "note.updated",
  "note.deleted",
] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

/** A webhook as listed: never its signing secret, shown once at creation. */
export interface Webhook {
  id: string;
  url: string;
  events: WebhookEventName[];
  active: boolean;
  createdAt: string;
  /** The last delivery: when, and the status it got or why it failed. */
  lastDeliveryAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
  /** Failures in a row; enough of them switches the webhook off. */
  failureCount: number;
}

export interface WebhooksResponse {
  webhooks: Webhook[];
}

export interface WebhookCreateRequest {
  url: string;
  /** Every event when left out. */
  events?: WebhookEventName[];
}

export interface WebhookCreatedResponse {
  webhook: Webhook;
  /** Signs every delivery (`X-Manifesto-Signature`). Shown this once. */
  secret: string;
}

/**
 * The body of every webhook delivery. `note` is the copy the webhook's owner
 * sees, their own color and tags included; a deletion carries only the id.
 */
export type WebhookPayload =
  | {
      event: "note.created" | "note.updated";
      deliveryId: string;
      occurredAt: string;
      note: Note;
    }
  | {
      event: "note.deleted";
      deliveryId: string;
      occurredAt: string;
      noteId: string;
    };

/** `GET /api/admin/overview`: what the server holds, and how its
 * background jobs are doing. */
export interface AdminOverviewResponse {
  version: string;
  /** Since this process started, in seconds. */
  uptimeSeconds: number;
  totals: {
    users: number;
    notes: number;
    trashedNotes: number;
    shares: number;
    attachments: number;
    attachmentBytes: number;
    versions: number;
  };
  /** Accounts by what they hold, the most first. */
  perUser: {
    user: ShareUser;
    notes: number;
    attachments: number;
    attachmentBytes: number;
  }[];
  /** What the update check last found; null with it off or not yet run. */
  update: {
    latest: string;
    url: string;
    checkedAt: string;
    available: boolean;
  } | null;
  jobs: {
    name: string;
    intervalMs: number;
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    lastDurationMs: number | null;
    lastError: string | null;
    running: boolean;
  }[];
}

/** `GET /api/admin/update`. */
export interface AdminUpdateResponse {
  version: string;
  update: AdminOverviewResponse["update"];
}

/** What the audit log records. */
export const AUDIT_ACTIONS = [
  "account.registered",
  "account.exported",
  "auth.signed_in",
  "auth.sign_in_failed",
  "auth.signed_out",
  "auth.password_changed",
  "auth.password_reset_requested",
  "auth.password_reset",
  "auth.two_factor_enabled",
  "auth.two_factor_disabled",
  "token.created",
  "token.revoked",
  "webhook.created",
  "webhook.deleted",
  "share.created",
  "share.role_changed",
  "share.removed",
  "admin.user_created",
  "admin.user_deleted",
  "admin.admin_granted",
  "admin.admin_revoked",
  "admin.email_changed",
  "admin.password_reset",
  "admin.user_exported",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** One line of the audit log, as `GET /api/admin/audit` lists it. */
export interface AuditEntry {
  id: string;
  at: string;
  action: AuditAction;
  /** Who did it; null when nobody was signed in (a failed sign-in). */
  actor: ShareUser | null;
  /** Whose account it was about, when not the actor's. */
  target: ShareUser | null;
  noteId: string | null;
  ip: string | null;
  /** A few words of detail: the method, a failure's reason, a role. */
  detail: Record<string, string>;
}

export interface AuditLogResponse {
  entries: AuditEntry[];
  /** Pass as `before` for older entries; null at the end. */
  nextBefore: string | null;
}

/** `GET /api/auth/two-factor`. */
export interface TwoFactorStatusResponse {
  enabled: boolean;
  /** Unused recovery codes left; 0 when two-factor is off. */
  recoveryCodesRemaining: number;
}

/**
 * `POST /api/auth/two-factor/setup`: the secret to put in an authenticator,
 * as base32. The client builds the `otpauth://` link from it, since the
 * product name that labels it there is the client's to know.
 */
export interface TwoFactorSetupResponse {
  secret: string;
}

/** Shown once, when two-factor is turned on or the codes are replaced. */
export interface TwoFactorRecoveryCodesResponse {
  recoveryCodes: string[];
}

/**
 * A machine-readable reason, sent alongside `error` only where a client has to
 * do something other than show the message.
 */
export type ErrorCode =
  | "password_change_required"
  | "email_taken"
  | "two_factor_required"
  | "two_factor_invalid";

export interface ErrorResponse {
  error: string;
  code?: ErrorCode;
}

// --- Link previews ---

export interface LinkPreviewResponse {
  /**
   * What the server could read from the page, or null when it could not be
   * fetched. `image` and `favicon` are the source images as fetched, inlined
   * as `data:` URLs up to `MAX_IMAGE_DATA_URL_BYTES`; they are not yet the
   * stored form, which the client shrinks to fit
   * `MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES`.
   */
  preview: LinkPreview | null;
}

// --- Search ---

export interface SearchParams {
  q: string;
}

// --- Auth ---

export interface AuthCredentials {
  username: string;
  password: string;
  /**
   * Read only when the account holds a temporary password: the sign-in then
   * sets this as the password instead of answering `password_change_required`.
   */
  newPassword?: string;
}

/** `POST /api/auth/register`. */
export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
}

/** `PUT /api/auth/me`: the signed-in user's own details. `null` clears. */
export interface AuthMeUpdateRequest {
  email: string | null;
}

export interface PasswordChangeRequest {
  currentPassword: string;
  newPassword: string;
}

export type AuthProviderName = "local" | "oidc";

/**
 * How a note's owner finds the person to share it with. `search` offers
 * matches as they type; `exact` finds an account only by its full username or
 * email address, so nobody can list who else is on the server.
 */
export type UserLookupMode = "search" | "exact";

export interface AuthMethodsResponse {
  /** The one way in, for clients from before `providers`; `oidc` when both
   * are on. */
  provider: AuthProviderName;
  /** Every way in this server offers. Absent from older servers, which offer
   * `provider` alone. */
  providers?: AuthProviderName[];
  /** With both on, whether the password form is shown or folded behind a
   * link under the single sign-on button. */
  passwordForm?: "shown" | "collapsed";
  userLookup: UserLookupMode;
  /** Whether this server lets users register webhooks. Absent from servers
   * from before webhooks, which have none. */
  webhooks?: boolean;
  /** Whether a forgotten password can be reset by a link sent by mail. */
  passwordReset?: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  email: string | null;
  isAdmin: boolean;
  /** Whether the account signs in with a password here (and so can change
   * it, and use two-factor), rather than through single sign-on. Absent from
   * older servers. */
  hasPassword?: boolean;
}

// --- Administration ---

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  email: string | null;
  isAdmin: boolean;
  /** How the account signs in: a password here, or an identity provider. */
  provider: AuthProviderName;
  /** Holds a temporary password that has not been replaced yet. */
  mustChangePassword: boolean;
  noteCount: number;
  createdAt: string;
  /** The most recent request of any live session; null when there is none. */
  lastSeenAt: string | null;
}

export interface AdminUsersResponse {
  users: AdminUser[];
}

export interface AdminUserResponse {
  user: AdminUser;
}

export interface AdminCreateUserRequest {
  username: string;
  email?: string;
}

/** At least one of the two. `email: null` clears it. */
export interface AdminUpdateUserRequest {
  isAdmin?: boolean;
  email?: string | null;
}

/**
 * A new account, or a reset one, with the password its owner signs in with
 * once. The server keeps only its hash, so this response is the one place it
 * can be read.
 */
export interface AdminTemporaryPasswordResponse {
  user: AdminUser;
  temporaryPassword: string;
}

export interface AuthMeResponse {
  user: AuthUser;
}

export interface AuthSuccessResponse {
  token: string;
  user: AuthUser;
}

// --- Sharing ---

/** `GET /api/users?q=`: accounts to share a note with. */
export interface UserLookupResponse {
  users: DirectoryUser[];
}

export interface DirectoryUser extends ShareUser {
  /** Shown only where the server searches its accounts (`search`). */
  email?: string;
}

/** `POST /api/notes/:id/shares`. */
export interface ShareCreateRequest {
  userId: string;
  role: ShareRole;
}

/** `PUT /api/notes/:id/shares/:userId`. */
export interface ShareUpdateRequest {
  role: ShareRole;
}

/** A note someone has offered to share with the signed-in user. */
export interface ShareInvitation {
  noteId: string;
  role: ShareRole;
  owner: ShareUser;
  /**
   * The note's title, text, color and font, so the invitation can show the
   * note itself to decide on. Its attachments and link previews wait until it
   * is accepted.
   */
  title: string;
  content: string;
  color: NoteColor;
  font: NoteFont;
  invitedAt: string;
}

export interface InvitationsResponse {
  invitations: ShareInvitation[];
}

// --- WebSocket events (server → client) ---

/**
 * How often the server sends `heartbeat` on `/api/ws`. A socket that dies
 * without a close stays open to both ends, so silence longer than a couple of
 * these is how each side learns it is talking to nobody.
 */
export const APP_SOCKET_HEARTBEAT_MS = 30_000;

export interface PresenceUser {
  id: string;
  displayName: string;
  avatarColor: string;
}

export type WebSocketEvent =
  | { type: "note:updated"; note: Note }
  | { type: "note:created"; note: Note }
  | { type: "note:deleted"; id: string }
  | { type: "presence:join"; noteId: string; user: PresenceUser }
  | { type: "presence:leave"; noteId: string; userId: string }
  | { type: "invitation:created"; invitation: ShareInvitation }
  | { type: "invitation:removed"; noteId: string }
  | { type: "heartbeat" };

// --- WebSocket events (client → server) ---

export type WebSocketClientEvent =
  | { type: "note:edit"; id: string; changes: Partial<Note> }
  | { type: "presence:update"; noteId: string | null };
