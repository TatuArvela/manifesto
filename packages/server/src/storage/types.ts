import type { Note, NoteCreate, NoteUpdate } from "@manifesto/shared";

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  provider: string;
  externalId: string | null;
  passwordHash: string | null;
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
  createdAt: string;
}

export interface UsersRepo {
  create(input: CreateUserInput): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  findByExternalId(provider: string, externalId: string): Promise<User | null>;
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

export interface NotesRepo {
  listByUser(userId: string): Promise<Note[]>;
  getById(id: string, userId: string): Promise<Note | null>;
  insert(input: InsertNoteInput): Promise<Note>;
  /**
   * Update a note, optionally constrained by the current `updated_at` for
   * optimistic concurrency. Returns null when the row doesn't exist, doesn't
   * belong to the user, or — if `expectedUpdatedAt` is provided — the row's
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
  search(userId: string, query: string): Promise<Note[]>;
}

export interface YjsStore {
  load(noteId: string, userId: string): Promise<Buffer | null>;
  /**
   * Persist Y.Doc state for a note. Does NOT touch the note's `updated_at`
   * field — Yjs writes are independent of REST writes, and bumping
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
