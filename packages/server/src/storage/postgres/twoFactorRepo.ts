import { AT_REST, atRest } from "#/storage/atRest.ts";
import { rowToTotp } from "#/storage/sqlite/twoFactorRepo.ts";
import type { TwoFactorRepo } from "#/storage/types.ts";
import type { PgPool } from "./database.ts";

/** See the SQLite copy: the same statements. */
export function createPostgresTwoFactorRepo(pool: PgPool): TwoFactorRepo {
  return {
    async get(userId) {
      const result = await pool.query(
        `SELECT secret, enabled_at, last_step FROM user_totp WHERE user_id = $1`,
        [userId],
      );
      const row = result.rows[0];
      return row ? rowToTotp(row) : null;
    },
    async begin(userId, plain, at) {
      const result = await pool.query(
        `INSERT INTO user_totp (user_id, secret, enabled_at, last_step, created_at)
         VALUES ($1, $2, NULL, 0, $3)
         ON CONFLICT (user_id) DO UPDATE SET secret = excluded.secret,
           created_at = excluded.created_at, last_step = 0
         WHERE user_totp.enabled_at IS NULL`,
        [userId, atRest.seal(plain, AT_REST.totpSecret), at],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async enable(userId, at, step) {
      await pool.query(
        `UPDATE user_totp SET enabled_at = $1, last_step = $2 WHERE user_id = $3`,
        [at, step, userId],
      );
    },
    async disable(userId) {
      await pool.query(`DELETE FROM user_totp WHERE user_id = $1`, [userId]);
    },
    async advanceStep(userId, step) {
      const result = await pool.query(
        `UPDATE user_totp SET last_step = $1 WHERE user_id = $2 AND last_step < $1`,
        [step, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}
