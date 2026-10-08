import type { SignInLinksRepo } from "../types.js";
import type { PgPool } from "./database.js";

export function createPostgresSignInLinksRepo(pool: PgPool): SignInLinksRepo {
  return {
    async create(input) {
      await pool.query(
        `INSERT INTO sign_in_links (token_hash, user_id, created_at, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [input.tokenHash, input.userId, input.createdAt, input.expiresAt],
      );
    },
    async find(tokenHash, now) {
      const result = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM sign_in_links
         WHERE token_hash = $2 AND used_at IS NULL AND expires_at > $1`,
        [now, tokenHash],
      );
      return result.rows[0]?.user_id ?? null;
    },
    async consume(tokenHash, now) {
      const result = await pool.query<{ user_id: string }>(
        `UPDATE sign_in_links SET used_at = $1
         WHERE token_hash = $2 AND used_at IS NULL AND expires_at > $1
         RETURNING user_id`,
        [now, tokenHash],
      );
      return result.rows[0]?.user_id ?? null;
    },
    async release(tokenHash) {
      await pool.query(
        `UPDATE sign_in_links SET used_at = NULL WHERE token_hash = $1`,
        [tokenHash],
      );
    },
    async delete(tokenHash) {
      await pool.query(`DELETE FROM sign_in_links WHERE token_hash = $1`, [
        tokenHash,
      ]);
    },
    async latestFor(userId) {
      const result = await pool.query<{ latest: string | null }>(
        `SELECT MAX(created_at) AS latest FROM sign_in_links WHERE user_id = $1`,
        [userId],
      );
      return result.rows[0]?.latest ?? null;
    },
    async deleteByUser(userId) {
      const result = await pool.query(
        `DELETE FROM sign_in_links WHERE user_id = $1`,
        [userId],
      );
      return result.rowCount ?? 0;
    },
    async deleteExpired(now) {
      const result = await pool.query(
        `DELETE FROM sign_in_links WHERE expires_at < $1`,
        [now],
      );
      return result.rowCount ?? 0;
    },
  };
}
