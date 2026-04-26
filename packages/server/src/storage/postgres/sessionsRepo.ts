import type { CreateSessionInput, Session, SessionsRepo } from "../types.js";
import type { PgPool } from "./database.js";

interface SessionRow {
  token: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

function rowToSession(row: SessionRow): Session {
  return {
    token: row.token,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function createPostgresSessionsRepo(pool: PgPool): SessionsRepo {
  return {
    async create(input: CreateSessionInput): Promise<Session> {
      const result = await pool.query<SessionRow>(
        `INSERT INTO sessions (token, user_id, created_at, expires_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          input.token,
          input.userId,
          input.createdAt,
          input.expiresAt,
          input.lastSeenAt,
        ],
      );
      return rowToSession(result.rows[0] as SessionRow);
    },

    async findByToken(token: string): Promise<Session | null> {
      const result = await pool.query<SessionRow>(
        `SELECT * FROM sessions WHERE token = $1`,
        [token],
      );
      const row = result.rows[0];
      return row ? rowToSession(row) : null;
    },

    async deleteByToken(token: string): Promise<void> {
      await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
    },

    async deleteExpired(nowIso: string): Promise<number> {
      const result = await pool.query(
        `DELETE FROM sessions WHERE expires_at < $1`,
        [nowIso],
      );
      return result.rowCount ?? 0;
    },

    async touch(
      token: string,
      lastSeenAt: string,
      expiresAt: string,
    ): Promise<void> {
      await pool.query(
        `UPDATE sessions SET last_seen_at = $1, expires_at = $2 WHERE token = $3`,
        [lastSeenAt, expiresAt, token],
      );
    },
  };
}
