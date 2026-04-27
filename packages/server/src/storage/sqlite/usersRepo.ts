import {
  type CreateUserInput,
  UsernameTakenError,
  type User,
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
  created_at: string;
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
    createdAt: row.created_at,
  };
}

export function createSqliteUsersRepo(db: SqliteDB): UsersRepo {
  const insertStmt = db.prepare(
    `INSERT INTO users (
      id, username, password_hash, display_name, avatar_color,
      provider, external_id, created_at
    ) VALUES (
      @id, @username, @passwordHash, @displayName, @avatarColor,
      @provider, @externalId, @createdAt
    )`,
  );
  const findByUsernameStmt = db.prepare(
    `SELECT * FROM users WHERE username = ? COLLATE NOCASE`,
  );
  const findByIdStmt = db.prepare(`SELECT * FROM users WHERE id = ?`);
  const findByExternalIdStmt = db.prepare(
    `SELECT * FROM users WHERE provider = ? AND external_id = ?`,
  );

  return {
    async create(input: CreateUserInput): Promise<User> {
      try {
        insertStmt.run(input);
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
  };
}
