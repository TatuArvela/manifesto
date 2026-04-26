import type { CreateUserInput, User, UsersRepo } from "../types.js";
import type { PgPool } from "./database.js";

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

export function createPostgresUsersRepo(pool: PgPool): UsersRepo {
  return {
    async create(input: CreateUserInput): Promise<User> {
      await pool.query(
        `INSERT INTO users (
          id, username, password_hash, display_name, avatar_color,
          provider, external_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          input.id,
          input.username,
          input.passwordHash,
          input.displayName,
          input.avatarColor,
          input.provider,
          input.externalId,
          input.createdAt,
        ],
      );
      const result = await pool.query<UserRow>(
        `SELECT * FROM users WHERE id = $1`,
        [input.id],
      );
      const row = result.rows[0];
      if (!row) throw new Error(`Failed to retrieve inserted user ${input.id}`);
      return rowToUser(row);
    },

    async findById(id: string): Promise<User | null> {
      const result = await pool.query<UserRow>(
        `SELECT * FROM users WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      return row ? rowToUser(row) : null;
    },

    async findByUsername(username: string): Promise<User | null> {
      const result = await pool.query<UserRow>(
        `SELECT * FROM users WHERE LOWER(username) = LOWER($1)`,
        [username],
      );
      const row = result.rows[0];
      return row ? rowToUser(row) : null;
    },

    async findByExternalId(
      provider: string,
      externalId: string,
    ): Promise<User | null> {
      const result = await pool.query<UserRow>(
        `SELECT * FROM users WHERE provider = $1 AND external_id = $2`,
        [provider, externalId],
      );
      const row = result.rows[0];
      return row ? rowToUser(row) : null;
    },
  };
}
