import type { AccountPrefs } from "@manifesto/shared";

// Accounts, their sign-in sessions, and the preferences of each account.

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  /** Unique, whatever the case, and optional. */
  email: string | null;
  provider: string;
  externalId: string | null;
  passwordHash: string | null;
  isAdmin: boolean;
  /**
   * The password is a temporary password that an admin gave. It is good for one
   * sign-in, which replaces it.
   */
  mustChangePassword: boolean;
  /**
   * The language that the client of the account reported, or null if none did.
   */
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
  /** Make the account an admin, whether it is the first or not. */
  isAdmin?: boolean;
  createdAt: string;
}

/**
 * A user as the admin listing shows them, with the data about their use of the
 * server that the listing needs.
 */
export interface UserSummary extends User {
  noteCount: number;
  /**
   * The latest `last_seen_at` of the sessions of the user, or null with none.
   */
  lastSeenAt: string | null;
}

/**
 * The result of a change that could remove the last admin of the server.
 * `last-admin` means that nothing was written.
 */
export type AdminGuardedResult = "ok" | "not-found" | "last-admin";

/** The result of a change of an email address. `email-taken` wrote nothing. */
export type SetEmailResult = "ok" | "not-found" | "email-taken";

export interface UserSearchOptions {
  /** Not included in the results: the person who searches. */
  excludeId: string;
  limit: number;
}

export interface UsersRepo {
  /**
   * Insert a user. The account is an admin when `isAdmin` says so. Otherwise,
   * it is an admin exactly when it is the first account. The insert itself
   * decides this, not a count read before. Thus, two sign-ups that arrive
   * together on an empty server cannot both see that there is nobody yet.
   */
  create(input: CreateUserInput): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  findByExternalId(provider: string, externalId: string): Promise<User | null>;
  /** Compared without regard to case. */
  findByEmail(email: string): Promise<User | null>;
  /**
   * Accounts whose username, display name or email contains `query`, whatever
   * the case, in the order of the username.
   */
  search(query: string, options: UserSearchOptions): Promise<User[]>;
  /** Set or clear the email address. */
  setEmail(id: string, email: string | null): Promise<SetEmailResult>;
  /** Record the language of the client of the account. */
  setLocale(id: string, locale: string): Promise<boolean>;
  /** All users, in the order of the username. */
  list(): Promise<UserSummary[]>;
  /** All admins, oldest first. */
  listAdmins(): Promise<User[]>;
  summarize(id: string): Promise<UserSummary | null>;
  /**
   * Give or remove admin rights. The code refuses to remove them from the only
   * admin, with an atomic count and write.
   */
  setAdmin(id: string, isAdmin: boolean): Promise<AdminGuardedResult>;
  /** Replace the password hash, and tell if it is a temporary password. */
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
 * `UsersRepo.create` throws this when it hits the unique constraint on the
 * username. Provider drivers change their native error code (SQLite
 * `SQLITE_CONSTRAINT_UNIQUE` / Postgres SQLSTATE `23505`) into this class.
 * Thus, callers do not have to search error messages for index names.
 */
export class UsernameTakenError extends Error {
  constructor(public readonly username: string) {
    super(`Username already taken: ${username}`);
    this.name = "UsernameTakenError";
  }
}

/** The same as `UsernameTakenError`, for the email address. */
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
  /**
   * End all sessions of a user, except the session whose (hashed) token is
   * `exceptToken`. Returns the number that it removed.
   */
  deleteByUser(userId: string, exceptToken?: string): Promise<number>;
  deleteExpired(nowIso: string): Promise<number>;
  touch(token: string, lastSeenAt: string, expiresAt: string): Promise<void>;
}

/** The preferences of each account. See `AccountPrefs`. */
export interface PrefsRepo {
  /** `{}` for an account that has none stored. */
  get(userId: string): Promise<AccountPrefs>;
  /**
   * Sets each key of `patch`, and removes the keys set to `null`, atomically.
   * Gives back the result. `tooLarge` when the result would be larger than
   * `maxBytes` as JSON. Then nothing is written.
   */
  merge(
    userId: string,
    patch: AccountPrefs,
    at: string,
    maxBytes: number,
  ): Promise<AccountPrefs | "tooLarge">;
  /** Removes all that is stored for the account. */
  clear(userId: string): Promise<void>;
}
