import type { AccountPrefs } from "@manifesto/shared";

// Accounts, their sign-in sessions, and each account's preferences.

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
