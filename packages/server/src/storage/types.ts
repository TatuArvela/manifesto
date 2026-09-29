import type {
  AccountPrefs,
  ApiToken,
  ApiTokenScope,
  AuditAction,
  Note,
  NoteCreate,
  NoteUpdate,
  NoteVersion,
  Passkey,
  PublicLink,
  PublicNote,
  ShareInvitation,
  ShareRole,
  ShareUser,
  TeamSource,
  Webhook,
  WebhookEventName,
} from "@manifesto/shared";

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  /** Unique regardless of case, and optional. */
  email: string | null;
  provider: string;
  externalId: string | null;
  passwordHash: string | null;
  isAdmin: boolean;
  /** The password is a temporary one an admin issued, good for one sign-in
   * that replaces it. */
  mustChangePassword: boolean;
  /** The language the account's client reported, or null if none has. */
  locale: string | null;
  createdAt: string;
}

export interface CreateUserInput {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  email?: string | null;
  provider: string;
  externalId: string | null;
  passwordHash: string | null;
  mustChangePassword?: boolean;
  /** Make the account an admin whether or not it is the first. */
  isAdmin?: boolean;
  createdAt: string;
}

/** A user as the admin listing shows them, with what the listing needs to say
 * about their use of the server. */
export interface UserSummary extends User {
  noteCount: number;
  /** Latest `last_seen_at` across the user's sessions, or null with none. */
  lastSeenAt: string | null;
}

/**
 * What became of a change that could take away the server's last admin.
 * `last-admin` means nothing was written.
 */
export type AdminGuardedResult = "ok" | "not-found" | "last-admin";

/** What became of setting an email address. `email-taken` wrote nothing. */
export type SetEmailResult = "ok" | "not-found" | "email-taken";

export interface UserSearchOptions {
  /** Left out of the results: the person searching. */
  excludeId: string;
  limit: number;
}

export interface UsersRepo {
  /**
   * Insert a user. The account is an admin when `isAdmin` says so, and
   * otherwise exactly when it is the first one. That is decided in the insert
   * itself rather than by a count read beforehand, so two sign-ups arriving
   * together on an empty server cannot both be told there is nobody yet.
   */
  create(input: CreateUserInput): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  findByExternalId(provider: string, externalId: string): Promise<User | null>;
  /** Compared regardless of case. */
  findByEmail(email: string): Promise<User | null>;
  /**
   * Accounts whose username, display name or email contains `query`,
   * regardless of case, ordered by username.
   */
  search(query: string, options: UserSearchOptions): Promise<User[]>;
  /** Set or clear the email address. */
  setEmail(id: string, email: string | null): Promise<SetEmailResult>;
  /** Record the language the account's client is set to. */
  setLocale(id: string, locale: string): Promise<boolean>;
  /** Every user, ordered by username. */
  list(): Promise<UserSummary[]>;
  /** Every admin, oldest first. */
  listAdmins(): Promise<User[]>;
  summarize(id: string): Promise<UserSummary | null>;
  /**
   * Grant or revoke admin. Revoking it from the only admin is refused, with
   * the count and the write made atomically.
   */
  setAdmin(id: string, isAdmin: boolean): Promise<AdminGuardedResult>;
  /** Replace the password hash and say whether it is a temporary one. */
  setPassword(
    id: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<boolean>;
  /**
   * Delete a user and, by cascade, their notes and sessions. The only admin
   * cannot be deleted.
   */
  delete(id: string): Promise<AdminGuardedResult>;
}

/**
 * Thrown by `UsersRepo.create` when the username unique constraint is hit.
 * Provider drivers map their native error code (SQLite
 * `SQLITE_CONSTRAINT_UNIQUE` / Postgres SQLSTATE `23505`) to this class so
 * callers don't have to grep error messages for index names.
 */
export class UsernameTakenError extends Error {
  constructor(public readonly username: string) {
    super(`Username already taken: ${username}`);
    this.name = "UsernameTakenError";
  }
}

/** As `UsernameTakenError`, for the email address. */
export class EmailTakenError extends Error {
  constructor(public readonly email: string) {
    super("Email address already taken");
    this.name = "EmailTakenError";
  }
}

export interface Session {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

export interface CreateSessionInput {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

export interface SessionsRepo {
  create(input: CreateSessionInput): Promise<Session>;
  findByToken(token: string): Promise<Session | null>;
  deleteByToken(token: string): Promise<void>;
  /** End every session a user holds, except the one whose (hashed) token is
   * `exceptToken`. Returns how many were removed. */
  deleteByUser(userId: string, exceptToken?: string): Promise<number>;
  deleteExpired(nowIso: string): Promise<number>;
  touch(token: string, lastSeenAt: string, expiresAt: string): Promise<void>;
}

export interface InsertNoteInput {
  id: string;
  userId: string;
  data: NoteCreate;
  createdAt: string;
  updatedAt: string;
}

/** One page of a listing, plus the cursor that reaches the next one. */
export interface NotePage {
  /**
   * Attachments are stripped: each note carries `imageCount` and an empty
   * `images`. A listing exists to say what notes there are, and sending every
   * attachment of every note is what made that answer unbounded.
   */
  notes: Note[];
  nextCursor: string | null;
}

export interface ListNotesOptions {
  limit: number;
  /** The `nextCursor` of the previous page. */
  cursor?: string;
}

/**
 * What a user may do with a note, and whose it is.
 *
 * A note shared with someone is theirs to read (and, as an editor, to write)
 * only while they have accepted it and its owner has not put it in the trash.
 * An invitation grants nothing.
 */
export interface NoteAccess {
  role: "owner" | ShareRole;
  ownerId: string;
}

/**
 * A write the caller's role does not allow: a recipient touching what only the
 * owner decides (the trash, auto-note markers), or a viewer touching the note
 * itself. Nothing was written.
 */
export class NoteAccessError extends Error {
  constructor(public readonly fields: string[]) {
    super(`Not allowed to change: ${fields.join(", ")}`);
    this.name = "NoteAccessError";
  }
}

/**
 * Notes as one user sees them: their own, and those shared with them that they
 * accepted. A shared note carries the recipient's own color, pin, archive,
 * position, tags and reminder in place of the owner's, and every note that has
 * members carries `sharing`.
 */
export interface NotesRepo {
  /** One page of the notes the user can see, newest first, without
   * attachments. */
  listByUser(userId: string, options: ListNotesOptions): Promise<NotePage>;
  /**
   * One page of the notes the user can see whose row or members changed after
   * `since` (an ISO timestamp), newest first, without attachments. A shared
   * note's personal fields need no column of their own: a recipient's write
   * stamps the note's `updated_at` like any other.
   */
  listChanged(
    userId: string,
    since: string,
    options: ListNotesOptions,
  ): Promise<NotePage>;
  /** The ids of every note the user can see, in no particular order. */
  visibleIds(userId: string): Promise<string[]>;
  /** A single note the user can see, attachments and all. */
  getById(id: string, userId: string): Promise<Note | null>;
  /** The user's role on a note they can see, or null. */
  access(id: string, userId: string): Promise<NoteAccess | null>;
  /** Whether any note, anyone's, has this id. */
  exists(id: string): Promise<boolean>;
  insert(input: InsertNoteInput): Promise<Note>;
  /**
   * Update a note, optionally constrained by the current `updated_at` for
   * optimistic concurrency. Returns null when the user cannot see the note
   * or (if `expectedUpdatedAt` is provided) its `updated_at` no longer
   * matches. Callers can disambiguate the cases with a follow-up `getById`.
   *
   * The owner's changes go to the note. A recipient's go to the note (the
   * shared fields, editors only) and to their share (the personal ones), and
   * stamp the note's `updated_at` either way, so everyone holds one
   * concurrency token. Throws `NoteAccessError` when the role does not allow
   * a field.
   */
  update(
    id: string,
    userId: string,
    changes: NoteUpdate,
    updatedAt: string,
    expectedUpdatedAt?: string,
  ): Promise<Note | null>;
  /** Owner only. The note's shares go with it. */
  delete(id: string, userId: string): Promise<boolean>;
  /** One page of matches among the notes the user can see, newest first,
   * without attachments. */
  search(
    userId: string,
    query: string,
    options: ListNotesOptions,
  ): Promise<NotePage>;
}

/** A note shared with one user: an invitation until `acceptedAt` is set. */
export interface NoteShare {
  noteId: string;
  userId: string;
  role: ShareRole;
  createdAt: string;
  acceptedAt: string | null;
  /** The team it came through; null for a share made to the user directly. */
  viaTeam: string | null;
}

/** Everyone with a stake in one note, for deciding who hears about it. */
export interface NoteAudience {
  ownerId: string;
  /** In the owner's trash, which hides it from everyone else. */
  trashed: boolean;
  /** Invitations and accepted shares both. */
  shares: NoteShare[];
}

export interface CreateShareInput {
  noteId: string;
  userId: string;
  role: ShareRole;
  createdAt: string;
  /** The team it comes through, if it does. */
  viaTeam?: string | null;
}

export interface SharesRepo {
  /** Null when there is no such note. */
  audience(noteId: string): Promise<NoteAudience | null>;
  /** Invite a user. `exists` when they already hold an invitation or a share,
   * and nothing was written. */
  create(input: CreateShareInput): Promise<"ok" | "exists">;
  setRole(noteId: string, userId: string, role: ShareRole): Promise<boolean>;
  /** Which team a share comes through, or null to make it a direct one. */
  setViaTeam(
    noteId: string,
    userId: string,
    teamId: string | null,
  ): Promise<boolean>;
  /**
   * Accept an invitation to a note that is not in its owner's trash. The
   * recipient starts with the note's color and at the end of their manual
   * order. False when there was no such invitation.
   */
  accept(noteId: string, userId: string, acceptedAt: string): Promise<boolean>;
  /** Remove an invitation or a share, returning what it was. */
  delete(noteId: string, userId: string): Promise<NoteShare | null>;
  /** The invitations waiting for a user, newest first, leaving out notes in
   * their owner's trash. */
  listInvitations(userId: string): Promise<ShareInvitation[]>;
  /** One invitation, as `listInvitations` describes it. */
  getInvitation(
    noteId: string,
    userId: string,
  ): Promise<ShareInvitation | null>;
  /** Every invitation and share a user holds on other people's notes. */
  listByRecipient(userId: string): Promise<NoteShare[]>;
  /** Every invitation and share on a user's own notes. */
  listByOwner(ownerId: string): Promise<NoteShare[]>;
}

export type { ShareUser };

/**
 * Keyed by the note and its owner. The collaboration socket authorizes a
 * participant before either is called, and passes the owner's id whoever the
 * participant is.
 */
export interface YjsStore {
  load(noteId: string, ownerId: string): Promise<Buffer | null>;
  /**
   * Persist Y.Doc state for a note. Does NOT touch the note's `updated_at`
   * field: Yjs writes are independent of REST writes, and bumping
   * `updated_at` on every keystroke would invalidate concurrent
   * `If-Match` tokens held by REST clients.
   */
  store(
    noteId: string,
    ownerId: string,
    state: Buffer,
    stateVector: Buffer,
  ): Promise<void>;
}

export interface ExpiredTrashedNote {
  id: string;
  userId: string;
}

export interface ServerStats {
  totals: {
    users: number;
    notes: number;
    trashedNotes: number;
    shares: number;
    attachments: number;
    attachmentBytes: number;
    versions: number;
  };
  /** Every account with what it holds; attachments are counted under the
   * notes' owner. */
  perUser: {
    userId: string;
    notes: number;
    attachments: number;
    attachmentBytes: number;
  }[];
}

export interface MaintenanceRepo {
  /** Counts for the admin overview, from plain aggregates. */
  stats(): Promise<ServerStats>;
  cleanupTrashedBefore(cutoffIso: string): Promise<ExpiredTrashedNote[]>;
  /**
   * Remove shares their recipients put in their own trash before the cutoff,
   * returning what was removed. The note stays with its owner and everyone
   * else; for the recipient it is gone, as a note of their own would be.
   */
  cleanupTrashedSharesBefore(cutoffIso: string): Promise<NoteShare[]>;
}

/** An image held in the attachment store, without its bytes. */
export interface AttachmentMeta {
  id: string;
  /** The owner of the notes that refer to it. */
  ownerId: string;
  sha256: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface StoredAttachment extends AttachmentMeta {
  data: Buffer;
}

/**
 * Images kept outside the note row (`attachment:<id>` in `Note.images`).
 * Content-addressed per owner: storing bytes an owner already has returns the
 * attachment that holds them, so sending the same inline image twice, as a
 * conflict retry or a stale tab does, never stores it twice.
 */
export interface AttachmentsRepo {
  put(input: Omit<StoredAttachment, "size">): Promise<AttachmentMeta>;
  get(id: string): Promise<StoredAttachment | null>;
  meta(id: string): Promise<AttachmentMeta | null>;
  /**
   * Whether `userId` may read it: they own it, or a note of its owner that
   * they hold an accepted share of, and the owner has not trashed, refers to
   * it.
   */
  readableBy(id: string, userId: string): Promise<boolean>;
  /**
   * Marks attachments no note refers to with `now`, clears the mark on those
   * referred to again, and deletes those marked before `cutoffIso`. Returns
   * how many it deleted.
   */
  sweep(now: string, cutoffIso: string): Promise<number>;
}

/**
 * A note's earlier title and content (connected mode's version history). The
 * repo keeps each note to `MAX_NOTE_VERSIONS` and `NOTE_VERSION_MAX_AGE_DAYS`
 * as versions are added; a deleted note takes its versions with it.
 */
export interface VersionsRepo {
  /** Newest first. */
  list(noteId: string): Promise<NoteVersion[]>;
  add(input: {
    id: string;
    noteId: string;
    authorId: string;
    title: string;
    content: string;
    createdAt: string;
  }): Promise<void>;
}

export interface StoredApiToken extends ApiToken {
  userId: string;
  /** When an OAuth grant's current access token lapses; null for a token
   * minted by hand, whose secret lasts as long as the token. */
  accessExpiresAt: string | null;
}

/** An OAuth grant's secrets, replaced together at every refresh. */
export interface OAuthGrantSecrets {
  tokenHash: string;
  refreshHash: string;
  accessExpiresAt: string;
}

/**
 * Personal API tokens, keyed by the SHA-256 of the secret. An assistant's
 * OAuth grant is one of them (`oauthClientId` set), with a refresh token
 * beside the access token.
 */
export interface ApiTokensRepo {
  create(
    input: StoredApiToken & { tokenHash: string; refreshHash?: string },
  ): Promise<void>;
  findByHash(tokenHash: string): Promise<StoredApiToken | null>;
  /** The grant whose current refresh token this is. */
  findByRefreshHash(refreshHash: string): Promise<StoredApiToken | null>;
  /** The grant whose refresh token this was until its last refresh. */
  findByPreviousRefreshHash(
    refreshHash: string,
  ): Promise<StoredApiToken | null>;
  /**
   * Replace a grant's secrets, if `refreshHash` is still its refresh token.
   * One statement, so of two refreshes with the same token only one wins.
   * The old refresh token is kept as the previous one.
   */
  rotate(refreshHash: string, next: OAuthGrantSecrets): Promise<boolean>;
  listByUser(userId: string): Promise<ApiToken[]>;
  /** The user's token, so one user cannot revoke another's. Returns the
   * deleted token's hash, which names the sockets it opened, or null. */
  delete(id: string, userId: string): Promise<string | null>;
  deleteByUser(userId: string): Promise<number>;
  touch(id: string, lastUsedAt: string): Promise<void>;
  deleteExpired(nowIso: string): Promise<number>;
}

/** An OAuth client that registered itself (`POST /api/oauth/register`). */
export interface StoredOAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  createdAt: string;
  /** When it was last given a grant; null until the first. */
  lastUsedAt: string | null;
}

/** What a consent hands out: good once, until `expiresAt`. */
export interface StoredOAuthCode {
  codeHash: string;
  clientId: string;
  /** Kept for the grant's name, since a client that identifies itself by
   * its metadata document is not stored. */
  clientName: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: ApiTokenScope[];
  /** When the grant it becomes ends; null for never. */
  grantExpiresAt: string | null;
  expiresAt: string;
}

/** The OAuth server's own rows; the grants themselves are API tokens. */
export interface OAuthRepo {
  createClient(client: StoredOAuthClient): Promise<void>;
  getClient(id: string): Promise<StoredOAuthClient | null>;
  touchClient(id: string, lastUsedAt: string): Promise<void>;
  /** Clients registered before `createdBefore` and never given a grant. */
  deleteUnusedClients(createdBefore: string): Promise<number>;
  createCode(code: StoredOAuthCode): Promise<void>;
  /** Takes a code out: a second redemption finds nothing. An expired code is
   * taken out too, and comes back null. */
  redeemCode(codeHash: string, nowIso: string): Promise<StoredOAuthCode | null>;
  deleteExpiredCodes(nowIso: string): Promise<number>;
}

export interface StoredWebhook extends Webhook {
  userId: string;
  secret: string;
}

export interface WebhookDeliveryResult {
  at: string;
  status: number | null;
  error: string | null;
  /** True for a delivery that failed: counts up, and switches the webhook
   * off at `disableAfter` failures in a row. False resets the count. */
  failed: boolean;
  disableAfter: number;
}

export interface WebhooksRepo {
  create(input: StoredWebhook): Promise<void>;
  listByUser(userId: string): Promise<StoredWebhook[]>;
  /** Active webhooks of a user subscribed to `event`. */
  activeFor(userId: string, event: WebhookEventName): Promise<StoredWebhook[]>;
  get(id: string, userId: string): Promise<StoredWebhook | null>;
  delete(id: string, userId: string): Promise<boolean>;
  /** Re-enables one switched off by failures, and clears its count. */
  setActive(id: string, userId: string, active: boolean): Promise<boolean>;
  recordDelivery(id: string, result: WebhookDeliveryResult): Promise<void>;
}

export interface TotpState {
  secret: string;
  /** Null while set up but not yet confirmed with a code. */
  enabledAt: string | null;
  lastStep: number;
}

/** Two-factor sign-in (TOTP) for local accounts. */
export interface TwoFactorRepo {
  get(userId: string): Promise<TotpState | null>;
  /** Starts (or restarts) a setup with a new secret, unconfirmed. Refused
   * (false) while two-factor is on: that has to be turned off first. */
  begin(userId: string, secret: string, at: string): Promise<boolean>;
  /** Confirms a setup, recording the step of the code that confirmed it. */
  enable(userId: string, at: string, step: number): Promise<void>;
  /** Removes the authenticator and the recovery codes. */
  disable(userId: string): Promise<void>;
  /** Removes the authenticator and keeps the recovery codes, which passkeys
   * share. */
  removeAuthenticator(userId: string): Promise<void>;
  /**
   * Records `step` as used if it is later than the last one, atomically, and
   * says whether it was. False is a code used before: refuse it.
   */
  advanceStep(userId: string, step: number): Promise<boolean>;
  replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void>;
  /** Spends one unused recovery code; false if there is no such code. */
  useRecoveryCode(userId: string, hash: string, at: string): Promise<boolean>;
  remainingRecoveryCodes(userId: string): Promise<number>;
}

/** A passkey as stored: the public half of the credential and whose it is. */
export interface StoredPasskey extends Passkey {
  userId: string;
  /** base64url, as the browser names it. */
  credentialId: string;
  /** The COSE public key, base64url. */
  publicKey: string;
  counter: number;
  transports: string[];
  /** The host it was made for. */
  rpId: string;
}

export interface PasskeysRepo {
  create(passkey: StoredPasskey): Promise<void>;
  /** Oldest first. */
  listByUser(userId: string): Promise<StoredPasskey[]>;
  findByCredentialId(credentialId: string): Promise<StoredPasskey | null>;
  /** Records a sign-in with it: the authenticator's new counter, and when. */
  recordUse(id: string, counter: number, at: string): Promise<void>;
  /** The user's passkey, so one user cannot remove another's. */
  delete(id: string, userId: string): Promise<boolean>;
  deleteByUser(userId: string): Promise<number>;
}

/** Password reset links sent by mail, keyed by the token's SHA-256. */
export interface PasswordResetsRepo {
  create(input: {
    tokenHash: string;
    userId: string;
    createdAt: string;
    expiresAt: string;
  }): Promise<void>;
  /**
   * Spends a link that is unused and unexpired at `now`, atomically, and
   * says whose account it resets; null for any other link.
   */
  consume(tokenHash: string, now: string): Promise<string | null>;
  /** When the user's latest link was made, for spacing them out. */
  latestFor(userId: string): Promise<string | null>;
  deleteExpired(now: string): Promise<number>;
}

export interface AuditRecord {
  id: string;
  at: string;
  action: AuditAction;
  actorId: string | null;
  targetId: string | null;
  noteId: string | null;
  ip: string | null;
  detail: Record<string, string>;
}

export interface AuditListOptions {
  limit: number;
  /** Entries older than this id (ids are ULIDs, so they sort by time). */
  before?: string;
  /** Entries where this account is the actor or the target. */
  userId?: string;
  action?: AuditAction;
}

export interface AuditRepo {
  append(record: AuditRecord): Promise<void>;
  /** Newest first. */
  list(options: AuditListOptions): Promise<AuditRecord[]>;
  deleteBefore(at: string): Promise<number>;
}

/** Each account's preferences; see `AccountPrefs`. */
export interface PrefsRepo {
  /** `{}` for an account that has none stored. */
  get(userId: string): Promise<AccountPrefs>;
  /**
   * Sets each key of `patch`, removing those set to `null`, atomically, and
   * gives back the result. `tooLarge` when the result would pass
   * `maxBytes` as JSON, and then nothing is written.
   */
  merge(
    userId: string,
    patch: AccountPrefs,
    at: string,
    maxBytes: number,
  ): Promise<AccountPrefs | "tooLarge">;
}

/**
 * A public link as the server keeps it: what its owner sees, and what only
 * the server reads (the password hash, and a snapshot link's copy of the note).
 */
export interface StoredPublicLink extends PublicLink {
  ownerId: string;
  passwordHash: string | null;
  /** The note as it stood when a `snapshot` link was made; null for `live`. */
  snapshot: PublicNote | null;
}

export interface PublicLinksRepo {
  create(link: StoredPublicLink): Promise<void>;
  /** A note's links, newest first. */
  listByNote(noteId: string): Promise<StoredPublicLink[]>;
  get(token: string): Promise<StoredPublicLink | null>;
  /** Revoke: the link stops working at once. False if the note has no such
   * link. */
  delete(token: string, noteId: string): Promise<boolean>;
  /**
   * Count one view, as one statement, if the link can still be viewed at `at`
   * (not expired, not used up). False when it cannot, so two viewers racing
   * for a link's last view cannot both have it.
   */
  recordView(token: string, at: string): Promise<boolean>;
}

export interface StoredTeam {
  id: string;
  name: string;
  source: TeamSource;
  createdAt: string;
  memberCount: number;
}

/** A note shared with a team. */
export interface NoteTeamShare {
  noteId: string;
  teamId: string;
  role: ShareRole;
  createdAt: string;
}

/**
 * Teams, their members, and the notes shared with them. Only the rows: what a
 * team share means for each member's own share is `sharing/teamShares.ts`.
 */
export interface TeamsRepo {
  /** `exists` when the source already has a team by that name. */
  create(team: Omit<StoredTeam, "memberCount">): Promise<"ok" | "exists">;
  get(id: string): Promise<StoredTeam | null>;
  findByName(source: TeamSource, name: string): Promise<StoredTeam | null>;
  /** Every team, by name. */
  list(): Promise<StoredTeam[]>;
  /** The teams a user is in, by name. */
  listForUser(userId: string): Promise<StoredTeam[]>;
  rename(id: string, name: string): Promise<"ok" | "exists" | "missing">;
  delete(id: string): Promise<boolean>;
  members(teamId: string): Promise<string[]>;
  /** False when they were already in it. */
  addMember(teamId: string, userId: string): Promise<boolean>;
  /** False when they were not in it. */
  removeMember(teamId: string, userId: string): Promise<boolean>;
  /** False when the note is already shared with the team. */
  shareNote(share: NoteTeamShare): Promise<boolean>;
  setNoteRole(
    noteId: string,
    teamId: string,
    role: ShareRole,
  ): Promise<boolean>;
  unshareNote(noteId: string, teamId: string): Promise<boolean>;
  /** The teams a note is shared with, oldest first. */
  sharesOfNote(noteId: string): Promise<NoteTeamShare[]>;
  /** The notes shared with a team. */
  notesOf(teamId: string): Promise<NoteTeamShare[]>;
}

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
  passwordResets: PasswordResetsRepo;
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
