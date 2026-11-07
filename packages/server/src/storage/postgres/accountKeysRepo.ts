import {
  ACCOUNT_KEYS_COLUMNS,
  type AccountKeysRow,
  accountKeysValues,
  rowToAccountKeys,
} from "#/storage/accountKeysMapping.ts";
import type { AccountKeysRepo } from "#/storage/types.ts";
import type { PgPool } from "./database.ts";

/** See the SQLite copy: the same statements. */
export function createPostgresAccountKeysRepo(pool: PgPool): AccountKeysRepo {
  return {
    async get(userId) {
      const result = await pool.query<AccountKeysRow>(
        `SELECT ${ACCOUNT_KEYS_COLUMNS} FROM account_keys WHERE user_id = $1`,
        [userId],
      );
      const row = result.rows[0];
      return row ? rowToAccountKeys(row) : null;
    },
    async create(keys) {
      const result = await pool.query(
        `INSERT INTO account_keys (${ACCOUNT_KEYS_COLUMNS})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (user_id) DO NOTHING`,
        accountKeysValues(keys),
      );
      return (result.rowCount ?? 0) > 0;
    },
    async setSecretWrap(userId, wrappedBySecret, at) {
      const result = await pool.query(
        `UPDATE account_keys SET wrapped_by_secret = $1, updated_at = $2
         WHERE user_id = $3`,
        [wrappedBySecret, at, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async setRecovery(userId, wrappedByRecovery, recoveryVerifierHash, at) {
      const result = await pool.query(
        `UPDATE account_keys SET wrapped_by_recovery = $1,
           recovery_verifier_hash = $2, updated_at = $3
         WHERE user_id = $4`,
        [wrappedByRecovery, recoveryVerifierHash, at, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async replaceUserKeys(userId, expectedVerifierHash, next, at) {
      const result = await pool.query(
        `UPDATE account_keys SET wrapped_by_secret = $1,
           wrapped_by_recovery = $2, recovery_verifier_hash = $3,
           updated_at = $4
         WHERE user_id = $5 AND recovery_verifier_hash = $6`,
        [
          next.wrappedBySecret,
          next.wrappedByRecovery,
          next.recoveryVerifierHash,
          at,
          userId,
          expectedVerifierHash,
        ],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async seenKeys(userId) {
      const result = await pool.query<{ peer_id: string; sealed: string }>(
        `SELECT peer_id, sealed FROM seen_keys WHERE user_id = $1`,
        [userId],
      );
      return Object.fromEntries(
        result.rows.map((row) => [row.peer_id, row.sealed]),
      );
    },
    async rememberKey(userId, peerId, sealed, at, max) {
      const others = await pool.query<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM seen_keys
         WHERE user_id = $1 AND peer_id <> $2`,
        [userId, peerId],
      );
      if (Number(others.rows[0]?.n ?? 0) >= max) return false;
      await pool.query(
        `INSERT INTO seen_keys (user_id, peer_id, sealed, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, peer_id) DO UPDATE SET sealed = EXCLUDED.sealed,
           updated_at = EXCLUDED.updated_at`,
        [userId, peerId, sealed, at],
      );
      return true;
    },
    async delete(userId) {
      // Sealed under the keys that go: nothing would open them again.
      await pool.query(`DELETE FROM seen_keys WHERE user_id = $1`, [userId]);
      const result = await pool.query(
        `DELETE FROM account_keys WHERE user_id = $1`,
        [userId],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}
