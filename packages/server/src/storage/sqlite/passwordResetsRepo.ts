import type { PasswordResetsRepo } from "../types.js";
import type { SqliteDB } from "./database.js";

export function createSqlitePasswordResetsRepo(
  db: SqliteDB,
): PasswordResetsRepo {
  const insertStmt = db.prepare(
    `INSERT INTO password_resets (token_hash, user_id, created_at, expires_at)
     VALUES (@tokenHash, @userId, @createdAt, @expiresAt)`,
  );
  const consumeStmt = db.prepare(
    `UPDATE password_resets SET used_at = @now
     WHERE token_hash = @tokenHash AND used_at IS NULL AND expires_at > @now
     RETURNING user_id`,
  );
  const latestStmt = db.prepare(
    `SELECT MAX(created_at) AS latest FROM password_resets WHERE user_id = ?`,
  );
  const expireStmt = db.prepare(
    `DELETE FROM password_resets WHERE expires_at < ?`,
  );
  return {
    async create(input) {
      insertStmt.run(input);
    },
    async consume(tokenHash, now) {
      const row = consumeStmt.get({ tokenHash, now }) as
        | { user_id: string }
        | undefined;
      return row?.user_id ?? null;
    },
    async latestFor(userId) {
      return (latestStmt.get(userId) as { latest: string | null }).latest;
    },
    async deleteExpired(now) {
      return expireStmt.run(now).changes;
    },
  };
}
