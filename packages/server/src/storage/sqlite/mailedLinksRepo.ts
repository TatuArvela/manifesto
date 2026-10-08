import type { MailedLinksRepo, MailedLinksTable } from "../types.js";
import type { SqliteDB } from "./database.js";

/** `table` is one of two names written here, never anything a caller sent. */
export function createSqliteMailedLinksRepo(
  db: SqliteDB,
  table: MailedLinksTable,
): MailedLinksRepo {
  const insertStmt = db.prepare(
    `INSERT INTO ${table} (token_hash, user_id, created_at, expires_at)
     VALUES (@tokenHash, @userId, @createdAt, @expiresAt)`,
  );
  const findStmt = db.prepare(
    `SELECT user_id FROM ${table}
     WHERE token_hash = @tokenHash AND used_at IS NULL AND expires_at > @now`,
  );
  const consumeStmt = db.prepare(
    `UPDATE ${table} SET used_at = @now
     WHERE token_hash = @tokenHash AND used_at IS NULL AND expires_at > @now
     RETURNING user_id`,
  );
  const releaseStmt = db.prepare(
    `UPDATE ${table} SET used_at = NULL WHERE token_hash = ?`,
  );
  const deleteStmt = db.prepare(`DELETE FROM ${table} WHERE token_hash = ?`);
  const latestStmt = db.prepare(
    `SELECT MAX(created_at) AS latest FROM ${table} WHERE user_id = ?`,
  );
  const deleteByUserStmt = db.prepare(`DELETE FROM ${table} WHERE user_id = ?`);
  const expireStmt = db.prepare(`DELETE FROM ${table} WHERE expires_at < ?`);
  return {
    async create(input) {
      insertStmt.run(input);
    },
    async find(tokenHash, now) {
      const row = findStmt.get({ tokenHash, now }) as
        | { user_id: string }
        | undefined;
      return row?.user_id ?? null;
    },
    async consume(tokenHash, now) {
      const row = consumeStmt.get({ tokenHash, now }) as
        | { user_id: string }
        | undefined;
      return row?.user_id ?? null;
    },
    async release(tokenHash) {
      releaseStmt.run(tokenHash);
    },
    async delete(tokenHash) {
      deleteStmt.run(tokenHash);
    },
    async latestFor(userId) {
      return (latestStmt.get(userId) as { latest: string | null }).latest;
    },
    async deleteByUser(userId) {
      return deleteByUserStmt.run(userId).changes;
    },
    async deleteExpired(now) {
      return expireStmt.run(now).changes;
    },
  };
}
