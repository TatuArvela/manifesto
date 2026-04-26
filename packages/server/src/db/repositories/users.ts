import type { DB } from "../index.js";

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  avatar_color: string;
  created_at: string;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
}

export function publicUserFromRow(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
  };
}

export interface CreateUserInput {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  avatarColor: string;
  createdAt: string;
}

export function createUsersRepo(db: DB) {
  const insertStmt = db.prepare(
    `INSERT INTO users (id, username, password_hash, display_name, avatar_color, created_at)
     VALUES (@id, @username, @passwordHash, @displayName, @avatarColor, @createdAt)`,
  );
  const findByUsernameStmt = db.prepare(
    `SELECT * FROM users WHERE username = ? COLLATE NOCASE`,
  );
  const findByIdStmt = db.prepare(`SELECT * FROM users WHERE id = ?`);

  return {
    async create(input: CreateUserInput): Promise<UserRow> {
      insertStmt.run(input);
      const row = findByIdStmt.get(input.id) as UserRow;
      return row;
    },

    async findByUsername(username: string): Promise<UserRow | null> {
      const row = findByUsernameStmt.get(username) as UserRow | undefined;
      return row ?? null;
    },

    async findById(id: string): Promise<UserRow | null> {
      const row = findByIdStmt.get(id) as UserRow | undefined;
      return row ?? null;
    },
  };
}

export type UsersRepo = ReturnType<typeof createUsersRepo>;
