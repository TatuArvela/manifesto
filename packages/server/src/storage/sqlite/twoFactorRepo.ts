import { AT_REST, atRest } from "#/storage/atRest.ts";
import type { TotpState, TwoFactorRepo } from "#/storage/types.ts";
import type { SqliteDB } from "./database.ts";

interface TotpRow {
  secret: string;
  enabled_at: string | null;
  last_step: number | string;
}

export function rowToTotp(row: TotpRow): TotpState {
  return {
    // Under the server key. A secret that does not open now matches no code
    // (`verifyTotp` refuses an empty secret).
    secret: atRest.open(row.secret, AT_REST.totpSecret) ?? "",
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
  const advanceStmt = db.prepare(
    `UPDATE user_totp SET last_step = ? WHERE user_id = ? AND last_step < ?`,
  );

  return {
    async get(userId) {
      const row = getStmt.get(userId) as TotpRow | undefined;
      return row ? rowToTotp(row) : null;
    },
    async begin(userId, secret, at) {
      return (
        beginStmt.run(userId, atRest.seal(secret, AT_REST.totpSecret), at)
          .changes > 0
      );
    },
    async enable(userId, at, step) {
      enableStmt.run(at, step, userId);
    },
    async disable(userId) {
      disableStmt.run(userId);
    },
    async advanceStep(userId, step) {
      return advanceStmt.run(step, userId, step).changes > 0;
    },
  };
}
