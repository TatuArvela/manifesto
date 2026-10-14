import {
  ACCOUNT_KEYS_COLUMNS,
  type AccountKeysRow,
  accountKeysValues,
  rowToAccountKeys,
} from "../accountKeysMapping.js";
import type { AccountKeysRepo } from "../types.js";
import type { SqliteDB } from "./database.js";

export function createSqliteAccountKeysRepo(db: SqliteDB): AccountKeysRepo {
  const getStmt = db.prepare(
    `SELECT ${ACCOUNT_KEYS_COLUMNS} FROM account_keys WHERE user_id = ?`,
  );
  // The primary key decides who was first, so two set-ups arriving together
  // cannot both be kept.
  const createStmt = db.prepare(
    `INSERT INTO account_keys (${ACCOUNT_KEYS_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO NOTHING`,
  );
  const secretStmt = db.prepare(
    `UPDATE account_keys SET wrapped_by_secret = ?, updated_at = ?
     WHERE user_id = ?`,
  );
  const recoveryStmt = db.prepare(
    `UPDATE account_keys SET wrapped_by_recovery = ?,
       recovery_verifier_hash = ?, updated_at = ?
     WHERE user_id = ?`,
  );
  const replaceStmt = db.prepare(
    `UPDATE account_keys SET wrapped_by_secret = ?, wrapped_by_recovery = ?,
       recovery_verifier_hash = ?, updated_at = ?
     WHERE user_id = ? AND recovery_verifier_hash = ?`,
  );
  const deleteStmt = db.prepare(`DELETE FROM account_keys WHERE user_id = ?`);
  const seenStmt = db.prepare(
    `SELECT peer_id, sealed FROM seen_keys WHERE user_id = ?`,
  );
  const seenCountStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM seen_keys WHERE user_id = ? AND peer_id <> ?`,
  );
  const rememberStmt = db.prepare(
    `INSERT INTO seen_keys (user_id, peer_id, sealed, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, peer_id) DO UPDATE SET sealed = excluded.sealed,
       updated_at = excluded.updated_at`,
  );
  // Sealed under the keys that are going: nothing would open them again.
  const forgetSeenStmt = db.prepare(`DELETE FROM seen_keys WHERE user_id = ?`);
  const remember = db.transaction(
    (
      userId: string,
      peerId: string,
      sealed: string,
      at: string,
      max: number,
    ) => {
      const { n } = seenCountStmt.get(userId, peerId) as { n: number };
      if (n >= max) return false;
      rememberStmt.run(userId, peerId, sealed, at);
      return true;
    },
  );

  return {
    async get(userId) {
      const row = getStmt.get(userId) as AccountKeysRow | undefined;
      return row ? rowToAccountKeys(row) : null;
    },
    async seenKeys(userId) {
      const rows = seenStmt.all(userId) as {
        peer_id: string;
        sealed: string;
      }[];
      return Object.fromEntries(rows.map((row) => [row.peer_id, row.sealed]));
    },
    async rememberKey(userId, peerId, sealed, at, max) {
      return remember.immediate(userId, peerId, sealed, at, max);
    },
    async create(keys) {
      return createStmt.run(...accountKeysValues(keys)).changes > 0;
    },
    async setSecretWrap(userId, wrappedBySecret, at) {
      return secretStmt.run(wrappedBySecret, at, userId).changes > 0;
    },
    async setRecovery(userId, wrappedByRecovery, recoveryVerifierHash, at) {
      return (
        recoveryStmt.run(wrappedByRecovery, recoveryVerifierHash, at, userId)
          .changes > 0
      );
    },
    async replaceUserKeys(userId, expectedVerifierHash, next, at) {
      return (
        replaceStmt.run(
          next.wrappedBySecret,
          next.wrappedByRecovery,
          next.recoveryVerifierHash,
          at,
          userId,
          expectedVerifierHash,
        ).changes > 0
      );
    },
    async delete(userId) {
      forgetSeenStmt.run(userId);
      return deleteStmt.run(userId).changes > 0;
    },
  };
}
