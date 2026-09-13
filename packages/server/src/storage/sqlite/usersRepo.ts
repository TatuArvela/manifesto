import {
  type AdminGuardedResult,
  type CreateUserInput,
  type User,
  UsernameTakenError,
  type UserSummary,
  type UsersRepo,
} from "../types.js";
import type { SqliteDB } from "./database.js";

interface UserRow {
  id: string;
  username: string;
  password_hash: string | null;
  display_name: string;
  avatar_color: string;
  provider: string;
  external_id: string | null;
  is_admin: number;
  must_change_password: number;
  created_at: string;
}

interface UserSummaryRow extends UserRow {
  note_count: number;
  last_seen_at: string | null;
}

interface SqliteError {
  code?: string;
  message?: string;
}

/**
 * better-sqlite3 surfaces uniqueness violations with `code = SQLITE_CONSTRAINT_UNIQUE`
 * and a message that includes the constraint origin (`users.username`). We
 * verify both so a future addition of another unique index doesn't get
 * misclassified.
 */
function isSqliteUniqueViolation(err: unknown, column: string): boolean {
  if (!(err instanceof Error)) return false;
  const sqliteErr = err as SqliteError;
  if (sqliteErr.code !== "SQLITE_CONSTRAINT_UNIQUE") return false;
  return (sqliteErr.message ?? "").toLowerCase().includes(`.${column}`);
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    provider: row.provider,
    externalId: row.external_id,
    passwordHash: row.password_hash,
    isAdmin: row.is_admin === 1,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
  };
}

function rowToSummary(row: UserSummaryRow): UserSummary {
  return {
    ...rowToUser(row),
    noteCount: row.note_count,
    lastSeenAt: row.last_seen_at,
  };
}

/** Aggregated in derived tables rather than per-row subqueries, the shape the
 * Postgres driver has to use, so both read the same way. */
const SUMMARY_SELECT = `
  SELECT u.*, COALESCE(n.note_count, 0) AS note_count, s.last_seen_at
  FROM users u
  LEFT JOIN (
    SELECT user_id, COUNT(*) AS note_count FROM notes GROUP BY user_id
  ) n ON n.user_id = u.id
  LEFT JOIN (
    SELECT user_id, MAX(last_seen_at) AS last_seen_at
    FROM sessions GROUP BY user_id
  ) s ON s.user_id = u.id`;

export function createSqliteUsersRepo(db: SqliteDB): UsersRepo {
  // `is_admin` is computed by the insert itself. better-sqlite3 runs one
  // statement at a time, so the NOT EXISTS and the row it decides about cannot
  // be split by another insert.
  const insertStmt = db.prepare(
    `INSERT INTO users (
      id, username, password_hash, display_name, avatar_color,
      provider, external_id, is_admin, must_change_password, created_at
    ) VALUES (
      @id, @username, @passwordHash, @displayName, @avatarColor,
      @provider, @externalId, NOT EXISTS (SELECT 1 FROM users),
      @mustChangePassword, @createdAt
    )`,
  );
  const findByUsernameStmt = db.prepare(
    `SELECT * FROM users WHERE username = ? COLLATE NOCASE`,
  );
  const findByIdStmt = db.prepare(`SELECT * FROM users WHERE id = ?`);
  const findByExternalIdStmt = db.prepare(
    `SELECT * FROM users WHERE provider = ? AND external_id = ?`,
  );
  const listStmt = db.prepare(`${SUMMARY_SELECT} ORDER BY u.username, u.id`);
  const summarizeStmt = db.prepare(`${SUMMARY_SELECT} WHERE u.id = ?`);
  const countAdminsStmt = db.prepare(
    `SELECT COUNT(*) AS count FROM users WHERE is_admin = 1`,
  );
  const setAdminStmt = db.prepare(`UPDATE users SET is_admin = ? WHERE id = ?`);
  const setPasswordStmt = db.prepare(
    `UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?`,
  );
  const deleteStmt = db.prepare(`DELETE FROM users WHERE id = ?`);

  /**
   * Would removing this user's admin leave the server without one? Run inside
   * an immediate transaction, which takes the write lock before the count, so
   * another process on the same file cannot demote the other admin in between.
   */
  function isLastAdmin(row: UserRow): boolean {
    if (row.is_admin !== 1) return false;
    return (countAdminsStmt.get() as { count: number }).count <= 1;
  }

  const setAdminTx = db.transaction(
    (id: string, isAdmin: boolean): AdminGuardedResult => {
      const row = findByIdStmt.get(id) as UserRow | undefined;
      if (!row) return "not-found";
      if (!isAdmin && isLastAdmin(row)) return "last-admin";
      setAdminStmt.run(isAdmin ? 1 : 0, id);
      return "ok";
    },
  );

  const deleteTx = db.transaction((id: string): AdminGuardedResult => {
    const row = findByIdStmt.get(id) as UserRow | undefined;
    if (!row) return "not-found";
    if (isLastAdmin(row)) return "last-admin";
    deleteStmt.run(id);
    return "ok";
  });

  return {
    async create(input: CreateUserInput): Promise<User> {
      try {
        insertStmt.run({
          id: input.id,
          username: input.username,
          passwordHash: input.passwordHash,
          displayName: input.displayName,
          avatarColor: input.avatarColor,
          provider: input.provider,
          externalId: input.externalId,
          mustChangePassword: input.mustChangePassword ? 1 : 0,
          createdAt: input.createdAt,
        });
      } catch (err) {
        if (isSqliteUniqueViolation(err, "username")) {
          throw new UsernameTakenError(input.username);
        }
        throw err;
      }
      const row = findByIdStmt.get(input.id) as UserRow;
      return rowToUser(row);
    },

    async findById(id: string): Promise<User | null> {
      const row = findByIdStmt.get(id) as UserRow | undefined;
      return row ? rowToUser(row) : null;
    },

    async findByUsername(username: string): Promise<User | null> {
      const row = findByUsernameStmt.get(username) as UserRow | undefined;
      return row ? rowToUser(row) : null;
    },

    async findByExternalId(
      provider: string,
      externalId: string,
    ): Promise<User | null> {
      const row = findByExternalIdStmt.get(provider, externalId) as
        | UserRow
        | undefined;
      return row ? rowToUser(row) : null;
    },

    async list(): Promise<UserSummary[]> {
      return (listStmt.all() as UserSummaryRow[]).map(rowToSummary);
    },

    async summarize(id: string): Promise<UserSummary | null> {
      const row = summarizeStmt.get(id) as UserSummaryRow | undefined;
      return row ? rowToSummary(row) : null;
    },

    async setAdmin(id: string, isAdmin: boolean): Promise<AdminGuardedResult> {
      return setAdminTx.immediate(id, isAdmin);
    },

    async setPassword(
      id: string,
      passwordHash: string,
      mustChangePassword: boolean,
    ): Promise<boolean> {
      const info = setPasswordStmt.run(
        passwordHash,
        mustChangePassword ? 1 : 0,
        id,
      );
      return info.changes > 0;
    },

    async delete(id: string): Promise<AdminGuardedResult> {
      return deleteTx.immediate(id);
    },
  };
}
