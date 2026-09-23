import type { PasswordResetsRepo } from "../types.js";
import type { PgPool } from "./database.js";

export function createPostgresPasswordResetsRepo(
  pool: PgPool,
): PasswordResetsRepo {
  return {
    async create(input) {
      await pool.query(
        `INSERT INTO password_resets (token_hash, user_id, created_at, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [input.tokenHash, input.userId, input.createdAt, input.expiresAt],
      );
    },
    async consume(tokenHash, now) {
      const result = await pool.query<{ user_id: string }>(
        `UPDATE password_resets SET used_at = $1
         WHERE token_hash = $2 AND used_at IS NULL AND expires_at > $1
         RETURNING user_id`,
        [now, tokenHash],
      );
      return result.rows[0]?.user_id ?? null;
    },
    async latestFor(userId) {
      const result = await pool.query<{ latest: string | null }>(
        `SELECT MAX(created_at) AS latest FROM password_resets WHERE user_id = $1`,
        [userId],
      );
      return result.rows[0]?.latest ?? null;
    },
    async deleteExpired(now) {
      const result = await pool.query(
        `DELETE FROM password_resets WHERE expires_at < $1`,
        [now],
      );
      return result.rowCount ?? 0;
    },
  };
}
