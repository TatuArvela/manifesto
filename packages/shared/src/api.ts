import type { LinkPreview, Note } from "./note.js";

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
export type ErrorCode = "password_change_required";

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

export interface PasswordChangeRequest {
  currentPassword: string;
  newPassword: string;
}

export type AuthProviderName = "local" | "oidc";

export interface AuthMethodsResponse {
  provider: AuthProviderName;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  isAdmin: boolean;
}

// --- Administration ---

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
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
}

export interface AdminUpdateUserRequest {
  isAdmin: boolean;
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
  | { type: "presence:leave"; noteId: string; userId: string };

// --- WebSocket events (client → server) ---

export type WebSocketClientEvent =
  | { type: "note:edit"; id: string; changes: Partial<Note> }
  | { type: "presence:update"; noteId: string | null };
