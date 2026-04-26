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
  update(
    id: string,
    userId: string,
    changes: NoteUpdate,
    updatedAt: string,
  ): Promise<Note | null>;
  delete(id: string, userId: string): Promise<boolean>;
  search(userId: string, query: string): Promise<Note[]>;
}

export interface YjsStore {
  load(noteId: string, userId: string): Promise<Buffer | null>;
  store(
    noteId: string,
    userId: string,
    state: Buffer,
    stateVector: Buffer,
    updatedAt: string,
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
