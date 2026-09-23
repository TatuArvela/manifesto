import {
  API_TOKEN_COLUMNS,
  type ApiTokenRow,
  listedToken,
  rowToApiToken,
} from "../apiTokenMapping.js";
import type { ApiTokensRepo } from "../types.js";
import type { SqliteDB } from "./database.js";

export function createSqliteApiTokensRepo(db: SqliteDB): ApiTokensRepo {
  const insertStmt = db.prepare(
    `INSERT INTO api_tokens
       (id, user_id, name, token_hash, prefix, created_at, last_used_at, expires_at)
     VALUES (@id, @userId, @name, @tokenHash, @prefix, @createdAt, @lastUsedAt, @expiresAt)`,
  );
  const byHashStmt = db.prepare(
    `SELECT ${API_TOKEN_COLUMNS} FROM api_tokens WHERE token_hash = ?`,
  );
  const byUserStmt = db.prepare(
    `SELECT ${API_TOKEN_COLUMNS} FROM api_tokens WHERE user_id = ?
     ORDER BY created_at DESC, id DESC`,
  );
  const deleteStmt = db.prepare(
    `DELETE FROM api_tokens WHERE id = ? AND user_id = ? RETURNING token_hash`,
  );
  const deleteByUserStmt = db.prepare(
    `DELETE FROM api_tokens WHERE user_id = ?`,
  );
  const touchStmt = db.prepare(
    `UPDATE api_tokens SET last_used_at = ? WHERE id = ?`,
  );
  const expireStmt = db.prepare(
    `DELETE FROM api_tokens WHERE expires_at IS NOT NULL AND expires_at < ?`,
  );

  return {
    async create(input) {
      insertStmt.run(input);
    },
    async findByHash(tokenHash) {
      const row = byHashStmt.get(tokenHash) as ApiTokenRow | undefined;
      return row ? rowToApiToken(row) : null;
    },
    async listByUser(userId) {
      return (byUserStmt.all(userId) as ApiTokenRow[])
        .map(rowToApiToken)
        .map(listedToken);
    },
    async delete(id, userId) {
      const row = deleteStmt.get(id, userId) as
        | { token_hash: string }
        | undefined;
      return row?.token_hash ?? null;
    },
    async deleteByUser(userId) {
      return deleteByUserStmt.run(userId).changes;
    },
    async touch(id, lastUsedAt) {
      touchStmt.run(lastUsedAt, id);
    },
    async deleteExpired(nowIso) {
      return expireStmt.run(nowIso).changes;
    },
  };
}
