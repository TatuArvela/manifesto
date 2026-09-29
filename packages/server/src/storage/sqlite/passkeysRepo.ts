import {
  PASSKEY_COLUMNS,
  type PasskeyRow,
  rowToPasskey,
} from "../passkeyMapping.js";
import type { PasskeysRepo } from "../types.js";
import type { SqliteDB } from "./database.js";

export function createSqlitePasskeysRepo(db: SqliteDB): PasskeysRepo {
  const insertStmt = db.prepare(
    `INSERT INTO passkeys (${PASSKEY_COLUMNS})
     VALUES (@id, @userId, @credentialId, @publicKey, @counter, @transports,
             @rpId, @name, @synced, @createdAt, @lastUsedAt)`,
  );
  const byUserStmt = db.prepare(
    `SELECT ${PASSKEY_COLUMNS} FROM passkeys WHERE user_id = ?
     ORDER BY created_at, id`,
  );
  const byCredentialStmt = db.prepare(
    `SELECT ${PASSKEY_COLUMNS} FROM passkeys WHERE credential_id = ?`,
  );
  const useStmt = db.prepare(
    `UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?`,
  );
  const deleteStmt = db.prepare(
    `DELETE FROM passkeys WHERE id = ? AND user_id = ?`,
  );
  const deleteByUserStmt = db.prepare(`DELETE FROM passkeys WHERE user_id = ?`);

  return {
    async create(passkey) {
      insertStmt.run({
        ...passkey,
        transports: JSON.stringify(passkey.transports),
        synced: passkey.synced ? 1 : 0,
      });
    },
    async listByUser(userId) {
      return (byUserStmt.all(userId) as PasskeyRow[]).map(rowToPasskey);
    },
    async findByCredentialId(credentialId) {
      const row = byCredentialStmt.get(credentialId) as PasskeyRow | undefined;
      return row ? rowToPasskey(row) : null;
    },
    async recordUse(id, counter, at) {
      useStmt.run(counter, at, id);
    },
    async delete(id, userId) {
      return deleteStmt.run(id, userId).changes > 0;
    },
    async deleteByUser(userId) {
      return deleteByUserStmt.run(userId).changes;
    },
  };
}
