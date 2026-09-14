import type {
  LinkPreview,
  Note,
  NoteColor,
  NoteFont,
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

/**
 * A machine-readable reason, sent alongside `error` only where a client has to
 * do something other than show the message.
 */
export type ErrorCode = "password_change_required" | "email_taken";

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
  provider: AuthProviderName;
  userLookup: UserLookupMode;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  email: string | null;
  isAdmin: boolean;
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
  | { type: "invitation:removed"; noteId: string };

// --- WebSocket events (client → server) ---

export type WebSocketClientEvent =
  | { type: "note:edit"; id: string; changes: Partial<Note> }
  | { type: "presence:update"; noteId: string | null };
