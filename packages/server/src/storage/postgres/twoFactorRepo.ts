import { AT_REST, atRest } from "#/storage/atRest.js";
import { rowToTotp } from "#/storage/sqlite/twoFactorRepo.js";
import type { TwoFactorRepo } from "#/storage/types.js";
import type { PgPool } from "./database.js";

/** See the SQLite copy. `begin` reads before it writes rather than using a
 * conditional upsert, which pg-mem does not parse. */
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
      const secret = atRest.seal(plain, AT_REST.totpSecret);
      const existing = await pool.query<{ enabled_at: string | null }>(
        `SELECT enabled_at FROM user_totp WHERE user_id = $1`,
        [userId],
      );
      const row = existing.rows[0];
      if (row && row.enabled_at !== null) return false;
      if (row) {
        await pool.query(
          `UPDATE user_totp SET secret = $1, created_at = $2, last_step = 0
           WHERE user_id = $3 AND enabled_at IS NULL`,
          [secret, at, userId],
        );
      } else {
        await pool.query(
          `INSERT INTO user_totp (user_id, secret, enabled_at, last_step, created_at)
           VALUES ($1, $2, NULL, 0, $3)`,
          [userId, secret, at],
        );
      }
      return true;
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
