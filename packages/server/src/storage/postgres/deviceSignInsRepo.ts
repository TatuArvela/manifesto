import type { DeviceSignInsRepo } from "#/storage/types.ts";
import type { PgPool } from "./database.ts";

export function createPostgresDeviceSignInsRepo(
  pool: PgPool,
): DeviceSignInsRepo {
  return {
    async create(input) {
      await pool.query(
        `INSERT INTO device_sign_ins
           (id_hash, wait_hash, user_agent, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          input.idHash,
          input.waitHash,
          input.userAgent,
          input.createdAt,
          input.expiresAt,
        ],
      );
    },
    async find(idHash, now) {
      const result = await pool.query<{
        user_agent: string;
        created_at: string;
        expires_at: string;
      }>(
        `SELECT user_agent, created_at, expires_at FROM device_sign_ins
         WHERE id_hash = $1 AND approved_at IS NULL AND used_at IS NULL
           AND expires_at > $2`,
        [idHash, now],
      );
      const row = result.rows[0];
      return row
        ? {
            userAgent: row.user_agent,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
          }
        : null;
    },
    async approve(idHash, userId, key, now) {
      const result = await pool.query(
        `UPDATE device_sign_ins
         SET user_id = $2, key_ephemeral = $3, key_wrapped = $4,
             approved_at = $5
         WHERE id_hash = $1 AND approved_at IS NULL AND used_at IS NULL
           AND expires_at > $5`,
        [idHash, userId, key?.ephemeral ?? null, key?.wrapped ?? null, now],
      );
      return result.rowCount === 1;
    },
    async claim(waitHash, now) {
      const result = await pool.query<{
        user_id: string;
        key_ephemeral: string | null;
        key_wrapped: string | null;
      }>(
        `UPDATE device_sign_ins SET used_at = $2
         WHERE wait_hash = $1 AND approved_at IS NOT NULL
           AND used_at IS NULL AND expires_at > $2
         RETURNING user_id, key_ephemeral, key_wrapped`,
        [waitHash, now],
      );
      const row = result.rows[0];
      if (row) {
        return {
          userId: row.user_id,
          key:
            row.key_ephemeral !== null && row.key_wrapped !== null
              ? { ephemeral: row.key_ephemeral, wrapped: row.key_wrapped }
              : null,
        };
      }
      const pending = await pool.query(
        `SELECT 1 FROM device_sign_ins
         WHERE wait_hash = $1 AND approved_at IS NULL AND expires_at > $2`,
        [waitHash, now],
      );
      return pending.rowCount ? "pending" : null;
    },
    async deleteByUser(userId) {
      const result = await pool.query(
        `DELETE FROM device_sign_ins WHERE user_id = $1 AND used_at IS NULL`,
        [userId],
      );
      return result.rowCount ?? 0;
    },
    async deleteExpired(now) {
      const result = await pool.query(
        `DELETE FROM device_sign_ins WHERE expires_at < $1`,
        [now],
      );
      return result.rowCount ?? 0;
    },
  };
}
