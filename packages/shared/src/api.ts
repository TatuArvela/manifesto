import type {
  LinkPreview,
  Note,
  NoteColor,
  NoteCreate,
  NoteFont,
  NoteVersion,
  ShareRole,
  ShareUser,
  TeamRef,
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

/**
 * One page of `GET /api/sync`: the notes that changed since a checkpoint.
 * Page through it as through `/api/notes`; `checkpoint` and `ids` come on the
 * last page only, and the next sync sends that checkpoint back as `since`.
 */
export interface SyncResponse extends NotesResponse {
  /**
   * Every note the user can see, changed or not. A note the client holds
   * whose id is missing here was deleted, or taken away from them, since.
   * Null on every page but the last.
   */
  ids: string[] | null;
  /** Opaque. Pass back as `since` next time; null on every page but the last. */
  checkpoint: string | null;
}

export interface NoteResponse {
  note: Note;
}

/** Notes per `POST /api/notes/import` request; a larger backup is sent in
 * several. */
export const MAX_NOTES_PER_IMPORT = 100;

/**
 * One note of `POST /api/notes/import`: a note as created, with the `id` and
 * `createdAt` it had where it came from. An `id` this user owns is updated in
 * place, so importing the same backup twice changes nothing; an `id` taken by
 * a note this user cannot write gets a new one.
 */
export type NoteImport = NoteCreate & { id?: string; createdAt?: string };

/** `POST /api/notes/import`. */
export interface NotesImportRequest {
  notes: NoteImport[];
}

export interface NotesImportResponse {
  created: number;
  updated: number;
  /** Notes shared with this user, which are someone else's to change. */
  skipped: number;
}

/** `POST /api/attachments`: the reference to put in a note's `images`. */
export interface AttachmentUploadResponse {
  ref: string;
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
/**
 * What a token is for. `api` (`mfp_`) works on the REST API and the sockets,
 * as a session does; `mcp` (`mfm_`) works only at `/api/mcp`, for an AI
 * assistant, so a secret copied into an assistant's settings can do only what
 * its tools do; `calendar` (`mfc_`) is the secret in a reminder feed's
 * address (`/api/calendar/<token>.ics`), since a calendar app sends no
 * header, and opens that feed and nothing else.
 */
export const API_TOKEN_KINDS = ["api", "mcp", "calendar"] as const;
export type ApiTokenKind = (typeof API_TOKEN_KINDS)[number];

/**
 * What a token may reach. Each route a token can call names one, and so does
 * each socket (`/api/ws` reads notes, `/api/yjs` writes them). A `:write`
 * scope includes its `:read`. A session has them all, and none of them
 * reaches what only a session may do (passwords, tokens, webhooks, admin).
 */
export const API_TOKEN_SCOPES = [
  "notes:read",
  "notes:write",
  "sharing",
  "account:read",
  "account:write",
] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

/** What a token gets when minted without naming any, and what every token
 * minted before scopes was narrowed to. */
export const DEFAULT_API_TOKEN_SCOPES: readonly ApiTokenScope[] = [
  "notes:read",
  "notes:write",
];

/** Whether `granted` covers `needed`, a `:write` covering its `:read`. */
export function hasScope(
  granted: readonly ApiTokenScope[],
  needed: ApiTokenScope,
): boolean {
  if (granted.includes(needed)) return true;
  return (
    needed.endsWith(":read") &&
    granted.includes(needed.replace(/:read$/, ":write") as ApiTokenScope)
  );
}

export interface ApiToken {
  id: string;
  name: string;
  kind: ApiTokenKind;
  scopes: ApiTokenScope[];
  /** The secret's first characters, so a user can tell tokens apart. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Null for a token that does not expire. */
  expiresAt: string | null;
  /**
   * For an assistant's token given by signing in through the browser (OAuth),
   * the client it was given to; absent for one minted by hand. Such a grant
   * hands out a new secret every hour, so `prefix` names only its first.
   */
  oauthClientId?: string;
}

export interface ApiTokensResponse {
  tokens: ApiToken[];
}

export interface ApiTokenCreateRequest {
  name: string;
  /** `api` when left out. */
  kind?: ApiTokenKind;
  /** `DEFAULT_API_TOKEN_SCOPES` when left out. An `mcp` token takes only
   * `notes:*`, which is all its tools reach. */
  scopes?: ApiTokenScope[];
  /** Days until it stops working; left out for a token that does not expire. */
  expiresInDays?: number;
}

export interface ApiTokenCreatedResponse {
  token: ApiToken;
  /** The bearer token itself. Shown this once; the server keeps only a hash. */
  secret: string;
}

/**
 * An assistant asking to be let in by OAuth (`GET /api/oauth/client`), as the
 * consent screen shows it. The client id is the address of the client's own
 * metadata document, or one this server gave out when the client registered.
 */
export interface OAuthClientInfo {
  clientId: string;
  /** What the client calls itself. */
  name: string;
  /**
   * The host that published the client's metadata document, which vouches
   * for the name; null for a client that registered itself here, whose name
   * nobody vouches for.
   */
  publisher: string | null;
  /** Where the browser goes once the user answers. */
  redirectUri: string;
  /** What it asked for, of what an assistant can be given. */
  scopes: ApiTokenScope[];
}

/** `POST /api/oauth/authorize`: the signed-in user lets the client in. */
export interface OAuthAuthorizeRequest {
  clientId: string;
  redirectUri: string;
  /** PKCE, S256 only. */
  codeChallenge: string;
  /** The client's, handed back to it untouched. */
  state?: string;
  /** What the user granted: `notes:read`, with or without `notes:write`. */
  scopes: ApiTokenScope[];
  /** Days until the grant ends; left out for one that does not. */
  expiresInDays?: number;
  password?: string;
}

export interface OAuthAuthorizeResponse {
  /** The client's redirect address with the code on it, to send the browser to. */
  redirectTo: string;
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
  "auth.passkey_added",
  "auth.passkey_removed",
  "token.created",
  "token.revoked",
  "webhook.created",
  "webhook.deleted",
  "share.created",
  "share.role_changed",
  "share.removed",
  "share.team_added",
  "share.team_role_changed",
  "share.team_removed",
  "link.created",
  "link.revoked",
  "admin.user_created",
  "admin.user_deleted",
  "admin.admin_granted",
  "admin.admin_revoked",
  "admin.email_changed",
  "admin.password_reset",
  "admin.user_exported",
  "admin.team_created",
  "admin.team_updated",
  "admin.team_deleted",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * One line of the audit log, as `GET /api/admin/audit` lists it, and
 * `GET /api/auth/me/activity` lists a user's own.
 */
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
  /** Whether sign-in asks for a second factor: an authenticator app, a
   * passkey, or both. */
  enabled: boolean;
  /** Whether an authenticator app is set up. Absent from servers from before
   * passkeys, where it is `enabled`. */
  authenticator?: boolean;
  /** Unused recovery codes left; 0 when two-factor is off. */
  recoveryCodesRemaining: number;
}

/**
 * WebAuthn's options and answers in their JSON form (WebAuthn Level 3), with
 * every binary value as base64url. The server builds and checks them; the
 * client only turns them into the browser's binary shapes and back.
 */
export interface PasskeyCredentialDescriptor {
  id: string;
  type: "public-key";
  transports?: string[];
}

export interface PasskeyCreationOptions {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { alg: number; type: "public-key" }[];
  timeout?: number;
  excludeCredentials?: PasskeyCredentialDescriptor[];
  authenticatorSelection?: {
    authenticatorAttachment?: string;
    residentKey?: string;
    requireResidentKey?: boolean;
    userVerification?: string;
  };
  hints?: string[];
  attestation?: string;
  extensions?: Record<string, unknown>;
}

export interface PasskeyRequestOptions {
  challenge: string;
  rpId?: string;
  timeout?: number;
  allowCredentials?: PasskeyCredentialDescriptor[];
  userVerification?: string;
  hints?: string[];
  extensions?: Record<string, unknown>;
}

export interface PasskeyRegistrationResponse {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
  authenticatorAttachment?: string;
  clientExtensionResults: Record<string, unknown>;
}

export interface PasskeyAuthenticationResponse {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  authenticatorAttachment?: string;
  clientExtensionResults: Record<string, unknown>;
}

/** A passkey as listed in Settings: never its key. */
export interface Passkey {
  id: string;
  name: string;
  /** Whether the passkey is synced between devices (a password manager's or
   * a platform's), rather than held by one device or security key. */
  synced: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

/** `GET /api/auth/passkeys`. */
export interface PasskeysResponse {
  passkeys: Passkey[];
}

/** `POST /api/auth/passkeys/options`, with the password. */
export interface PasskeyOptionsResponse {
  options: PasskeyCreationOptions;
}

/** `POST /api/auth/passkeys`: the browser's answer, and what to call it. */
export interface PasskeyAddRequest {
  name?: string;
  response: PasskeyRegistrationResponse;
}

/**
 * The passkey added, and the recovery codes when it is the account's first
 * second factor (shown once, as when an authenticator is set up first).
 */
export interface PasskeyAddedResponse {
  passkey: Passkey;
  recoveryCodes: string[] | null;
}

/** `POST /api/auth/passkey/options`: a challenge to sign in with a passkey. */
export interface PasskeySignInOptionsResponse {
  options: PasskeyRequestOptions;
}

/**
 * The 403 `two_factor_required` answer to a sign-in: which second factors
 * the account has, and a challenge for its passkeys on this address.
 */
export interface TwoFactorRequiredResponse extends ErrorResponse {
  code: "two_factor_required";
  twoFactor?: {
    authenticator: boolean;
    passkey: PasskeyRequestOptions | null;
  };
}

/**
 * `POST /api/auth/two-factor/setup`: the secret to put in an authenticator,
 * as base32. The client builds the `otpauth://` link from it, since the
 * product name that labels it there is the client's to know.
 */
export interface TwoFactorSetupResponse {
  secret: string;
}

/** Shown once, when two-factor is turned on or the codes are replaced.
 * Empty when an authenticator is added to an account whose passkeys
 * already have codes, which it shares. */
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
  | "two_factor_invalid"
  /** An action that takes the password was sent without it. */
  | "confirmation_required"
  | "password_incorrect"
  /** An account without a password has to have signed in recently. */
  | "reauthentication_required";

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
   * stored form: the client shrinks each to fit
   * `MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES` and uploads it as an attachment.
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

/**
 * The features a host can turn off, each with an environment variable. The
 * server's registry (`features.ts`) says which variable and what each covers;
 * `GET /api/capabilities` reports them, so a client hides what is off.
 */
export const SERVER_FEATURES = [
  "sharing",
  "teams",
  "publicLinks",
  "linkPreviews",
  "calendar",
  "apiTokens",
  "mcp",
  "webhooks",
  "passkeys",
  "twoFactor",
  "adminExport",
] as const;

export type ServerFeature = (typeof SERVER_FEATURES)[number];

/**
 * `GET /api/capabilities`: what this server is and offers, for a client to
 * decide what to show before anyone signs in, and for a script to learn its
 * limits rather than find them. Public, and covered by the compatibility
 * policy, so fields are only ever added.
 */
export interface CapabilitiesResponse {
  /** The running version, as `/api/health` gives it. */
  version: string;
  auth: {
    /** Every way in: `local` (a password), `oidc` (single sign-on). */
    providers: AuthProviderName[];
    /** With both on, whether the password form is shown or folded behind a
     * link under the single sign-on button. */
    passwordForm: "shown" | "collapsed";
    /** Whether anyone can create an account with a password. */
    registration: boolean;
    /** Whether a forgotten password can be reset by a link sent by mail. */
    passwordReset: boolean;
    /** Whether a local account can sign in with a passkey alone. */
    passkeys: boolean;
  };
  /**
   * Which of the features a host can turn off are on (`SERVER_FEATURES`), and
   * two answers derived from them. An operation of a feature that is off
   * answers 404, as a route that does not exist would.
   */
  features: Record<ServerFeature, boolean> & {
    /** Whether an assistant can connect to `/api/mcp` by signing in (OAuth). */
    mcpSignIn: boolean;
    /** How someone sharing a note finds the person to share it with. */
    userLookup: UserLookupMode;
  };
  /** The limits a caller would otherwise meet as a 413, 409 or 422. */
  limits: {
    /** Bytes in a request body, attachments aside. */
    requestBytes: number;
    /** Bytes in one uploaded image. */
    imageBytes: number;
    imagesPerNote: number;
    linkPreviewsPerNote: number;
    /** Notes in one page of `/api/notes` or `/api/search`. */
    notesPerPage: number;
    notesPerImport: number;
    /** Versions kept per note, and for how many days. */
    noteVersions: number;
    noteVersionDays: number;
    apiTokensPerUser: number;
    webhooksPerUser: number;
    passkeysPerUser: number;
    publicLinkViews: number;
    accountPrefsBytes: number;
  };
  /** The editor's schema version; `/api/yjs` refuses an editor older than
   * it (`EDITOR_SCHEMA_VERSION`). */
  editorSchemaVersion: number;
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
  /** The language the account's client last reported, used for mail sent to
   * it; null until one has. Absent from older servers. */
  locale?: string | null;
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
  /** Whether the server lets an admin download an account's notes
   * (`ADMIN_EXPORT`). */
  adminExport: boolean;
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
  /** The team the note was shared with, when it came that way. */
  team?: TeamRef;
}

export interface InvitationsResponse {
  invitations: ShareInvitation[];
}

// --- Teams ---

/**
 * Where a team's members come from: `local` teams are made and filled by an
 * admin; `oidc` teams mirror a group at the identity provider, and their
 * members change only when someone signs in.
 */
export const TEAM_SOURCES = ["local", "oidc"] as const;
export type TeamSource = (typeof TEAM_SOURCES)[number];

/** A team as one of its members sees it. */
export interface Team {
  id: string;
  name: string;
  source: TeamSource;
  memberCount: number;
}

/** A team as the admin view shows it, members and all. */
export interface AdminTeam extends Team {
  members: ShareUser[];
  createdAt: string;
}

export interface TeamsResponse {
  teams: Team[];
}

export interface AdminTeamsResponse {
  teams: AdminTeam[];
}

export interface AdminTeamResponse {
  team: AdminTeam;
}

export interface AdminTeamCreateRequest {
  name: string;
  memberIds?: string[];
}

/** Members only for a `local` team; an `oidc` team's are the provider's. */
export interface AdminTeamUpdateRequest {
  name?: string;
  memberIds?: string[];
}

/** A note shared with a team, as its owner sees it. */
export interface TeamShare {
  teamId: string;
  name: string;
  role: ShareRole;
}

export interface TeamSharesResponse {
  teamShares: TeamShare[];
}

export interface TeamShareCreateRequest {
  teamId: string;
  role: ShareRole;
}

// --- Public links ---

/**
 * What a public link shows: `live` follows the note as it changes, `snapshot`
 * keeps the note as it was when the link was made.
 */
export const PUBLIC_LINK_MODES = ["live", "snapshot"] as const;
export type PublicLinkMode = (typeof PUBLIC_LINK_MODES)[number];

/** Most views a link can be limited to; past it, a limit means nothing. */
export const MAX_PUBLIC_LINK_VIEWS = 10_000;

/** A public link as its owner sees it. The token is the link. */
export interface PublicLink {
  token: string;
  noteId: string;
  mode: PublicLinkMode;
  /** Null for a link that does not expire. */
  expiresAt: string | null;
  hasPassword: boolean;
  /** Null for no limit. */
  maxViews: number | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
}

export interface PublicLinkCreateRequest {
  mode: PublicLinkMode;
  /** Days from now until it stops working; left out, it does not expire. */
  expiresInDays?: number;
  /** Asked of every viewer before the note is shown. */
  password?: string;
  maxViews?: number;
}

export interface PublicLinkResponse {
  link: PublicLink;
}

export interface PublicLinksResponse {
  links: PublicLink[];
}

/**
 * A note as a public link shows it to anyone holding the link: the text and
 * how it looks, and nothing about who wrote it, its tags or its place among
 * the owner's notes. `images` and link preview pictures are `attachment:`
 * references, served by `GET /api/public/:token/attachments/:id`.
 */
export interface PublicNote {
  title: string;
  content: string;
  color: NoteColor;
  font: NoteFont;
  images: string[];
  linkPreviews: LinkPreview[];
  /** When the text shown last changed: the note's, or the snapshot's. */
  updatedAt: string;
}

export interface PublicNoteResponse {
  note: PublicNote;
  /**
   * For a link with a password, what the attachment requests carry as
   * `X-Link-Access`, so the password is checked once and not per image.
   * Null for a link without one.
   */
  access: string | null;
}

/** `GET /api/public/:token` of a link with a password, before it is given. */
export interface PublicNoteLockedResponse {
  passwordRequired: true;
}

// --- Preferences ---

/**
 * An account's preferences, as its clients last sent them: a flat object of
 * JSON values, keyed by the client's own names. The server stores it and
 * never reads a value; each client parses what it gets as it would a
 * hand-edited blob. Sparse: a key no client has sent is absent.
 */
export type AccountPrefs = Record<string, unknown>;

/** How large `AccountPrefs` may grow, as JSON. */
export const MAX_ACCOUNT_PREFS_BYTES = 16_384;

/** `GET /api/auth/me/prefs`, and the answer to a `PATCH`. */
export interface AccountPrefsResponse {
  prefs: AccountPrefs;
}

/** `PATCH /api/auth/me/prefs`: the keys to set; `null` removes one. */
export interface AccountPrefsUpdate {
  prefs: AccountPrefs;
}

// --- WebSocket events (server → client) ---

/**
 * How often the server sends `heartbeat` on `/api/ws`. A socket that dies
 * without a close stays open to both ends, so silence longer than a couple of
 * these is how each side learns it is talking to nobody.
 */
export const APP_SOCKET_HEARTBEAT_MS = 30_000;

/**
 * The version of the document shape the editor writes into a note's shared
 * Y.Doc on `/api/yjs`. Raise it whenever a node or mark is added, removed or
 * changes its attributes: an editor that meets a node it has no schema for
 * drops it, and `ySyncPlugin` then writes the loss back to everyone.
 *
 * The client sends its version as the `editor` query parameter of the socket
 * URL, and the server refuses a lower one than its own with
 * `EDITOR_OUTDATED_REASON`. A client that sends none is version 1, the shape
 * from before the check existed.
 */
export const EDITOR_SCHEMA_VERSION = 1;

/** The refusal reason `/api/yjs` gives an editor older than the server's. */
export const EDITOR_OUTDATED_REASON = "editor-outdated";

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
  | { type: "prefs:updated"; prefs: AccountPrefs }
  | { type: "heartbeat" };

// --- WebSocket events (client → server) ---

export type WebSocketClientEvent =
  | { type: "note:edit"; id: string; changes: Partial<Note> }
  | { type: "presence:update"; noteId: string | null };
