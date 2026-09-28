import {
  PASSKEY_COLUMNS,
  type PasskeyRow,
  rowToPasskey,
} from "../passkeyMapping.js";
import type { PasskeysRepo } from "../types.js";
import type { PgPool } from "./database.js";

export function createPostgresPasskeysRepo(pool: PgPool): PasskeysRepo {
  return {
    async create(passkey) {
      await pool.query(
        `INSERT INTO passkeys (${PASSKEY_COLUMNS})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          passkey.id,
          passkey.userId,
          passkey.credentialId,
          passkey.publicKey,
          passkey.counter,
          JSON.stringify(passkey.transports),
          passkey.rpId,
          passkey.name,
          passkey.synced,
          passkey.createdAt,
          passkey.lastUsedAt,
        ],
      );
    },
    async listByUser(userId) {
      const result = await pool.query<PasskeyRow>(
        `SELECT ${PASSKEY_COLUMNS} FROM passkeys WHERE user_id = $1
         ORDER BY created_at, id`,
        [userId],
      );
      return result.rows.map(rowToPasskey);
    },
    async findByCredentialId(credentialId) {
      const result = await pool.query<PasskeyRow>(
        `SELECT ${PASSKEY_COLUMNS} FROM passkeys WHERE credential_id = $1`,
        [credentialId],
      );
      const row = result.rows[0];
      return row ? rowToPasskey(row) : null;
    },
    async recordUse(id, counter, at) {
      await pool.query(
        `UPDATE passkeys SET counter = $1, last_used_at = $2 WHERE id = $3`,
        [counter, at, id],
      );
    },
    async delete(id, userId) {
      const result = await pool.query(
        `DELETE FROM passkeys WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async deleteByUser(userId) {
      const result = await pool.query(
        `DELETE FROM passkeys WHERE user_id = $1`,
        [userId],
      );
      return result.rowCount ?? 0;
    },
  };
}
