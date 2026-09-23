import type { TotpState, TwoFactorRepo } from "../types.js";
import type { SqliteDB } from "./database.js";

interface TotpRow {
  secret: string;
  enabled_at: string | null;
  last_step: number | string;
}

export function rowToTotp(row: TotpRow): TotpState {
  return {
    secret: row.secret,
    enabledAt: row.enabled_at,
    lastStep: Number(row.last_step),
  };
}

export function createSqliteTwoFactorRepo(db: SqliteDB): TwoFactorRepo {
  const getStmt = db.prepare(
    `SELECT secret, enabled_at, last_step FROM user_totp WHERE user_id = ?`,
  );
  const beginStmt = db.prepare(
    `INSERT INTO user_totp (user_id, secret, enabled_at, last_step, created_at)
     VALUES (?, ?, NULL, 0, ?)
     ON CONFLICT (user_id) DO UPDATE SET secret = excluded.secret,
       created_at = excluded.created_at, last_step = 0
     WHERE user_totp.enabled_at IS NULL`,
  );
  const enableStmt = db.prepare(
    `UPDATE user_totp SET enabled_at = ?, last_step = ? WHERE user_id = ?`,
  );
  const disableStmt = db.prepare(`DELETE FROM user_totp WHERE user_id = ?`);
  const clearCodesStmt = db.prepare(
    `DELETE FROM totp_recovery_codes WHERE user_id = ?`,
  );
  const addCodeStmt = db.prepare(
    `INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES (?, ?)`,
  );
  const advanceStmt = db.prepare(
    `UPDATE user_totp SET last_step = ? WHERE user_id = ? AND last_step < ?`,
  );
  const useCodeStmt = db.prepare(
    `UPDATE totp_recovery_codes SET used_at = ?
     WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
  );
  const remainingStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM totp_recovery_codes
     WHERE user_id = ? AND used_at IS NULL`,
  );

  const replaceCodes = db.transaction((userId: string, hashes: string[]) => {
    clearCodesStmt.run(userId);
    for (const hash of hashes) addCodeStmt.run(userId, hash);
  });
  const disable = db.transaction((userId: string) => {
    disableStmt.run(userId);
    clearCodesStmt.run(userId);
  });

  return {
    async get(userId) {
      const row = getStmt.get(userId) as TotpRow | undefined;
      return row ? rowToTotp(row) : null;
    },
    async begin(userId, secret, at) {
      return beginStmt.run(userId, secret, at).changes > 0;
    },
    async enable(userId, at, step) {
      enableStmt.run(at, step, userId);
    },
    async disable(userId) {
      disable(userId);
    },
    async advanceStep(userId, step) {
      return advanceStmt.run(step, userId, step).changes > 0;
    },
    async replaceRecoveryCodes(userId, hashes) {
      replaceCodes(userId, hashes);
    },
    async useRecoveryCode(userId, hash, at) {
      return useCodeStmt.run(at, userId, hash).changes > 0;
    },
    async remainingRecoveryCodes(userId) {
      return (remainingStmt.get(userId) as { n: number }).n;
    },
  };
}
