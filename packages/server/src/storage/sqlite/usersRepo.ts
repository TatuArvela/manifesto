import type { CreateUserInput, User, UsersRepo } from "../types.js";
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
      insertStmt.run(input);
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
