import type { Note, NoteCreate, NoteUpdate } from "@manifesto/shared";

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  provider: string;
  externalId: string | null;
  passwordHash: string | null;
  isAdmin: boolean;
  /** The password is a temporary one an admin issued, good for one sign-in
   * that replaces it. */
  mustChangePassword: boolean;
  createdAt: string;
}

export interface CreateUserInput {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
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

export interface NotesRepo {
  /** One page of the user's notes, newest first, without attachments. */
  listByUser(userId: string, options: ListNotesOptions): Promise<NotePage>;
  /** A single note, attachments and all. */
  getById(id: string, userId: string): Promise<Note | null>;
  insert(input: InsertNoteInput): Promise<Note>;
  /**
   * Update a note, optionally constrained by the current `updated_at` for
   * optimistic concurrency. Returns null when the row doesn't exist, doesn't
   * belong to the user, or (if `expectedUpdatedAt` is provided) the row's
   * `updated_at` no longer matches. Callers can disambiguate the three cases
   * with a follow-up `getById` lookup.
   */
  update(
    id: string,
    userId: string,
    changes: NoteUpdate,
    updatedAt: string,
    expectedUpdatedAt?: string,
  ): Promise<Note | null>;
  delete(id: string, userId: string): Promise<boolean>;
  /** One page of matches, newest first, without attachments. */
  search(
    userId: string,
    query: string,
    options: ListNotesOptions,
  ): Promise<NotePage>;
}

export interface YjsStore {
  load(noteId: string, userId: string): Promise<Buffer | null>;
  /**
   * Persist Y.Doc state for a note. Does NOT touch the note's `updated_at`
   * field: Yjs writes are independent of REST writes, and bumping
   * `updated_at` on every keystroke would invalidate concurrent
   * `If-Match` tokens held by REST clients.
   */
  store(
    noteId: string,
    userId: string,
    state: Buffer,
    stateVector: Buffer,
  ): Promise<void>;
}

export interface ExpiredTrashedNote {
  id: string;
  userId: string;
}

export interface MaintenanceRepo {
  cleanupTrashedBefore(cutoffIso: string): Promise<ExpiredTrashedNote[]>;
}

export interface StorageDriver {
  users: UsersRepo;
  sessions: SessionsRepo;
  notes: NotesRepo;
  yjs: YjsStore;
  maintenance: MaintenanceRepo;
  close(): Promise<void>;
}
