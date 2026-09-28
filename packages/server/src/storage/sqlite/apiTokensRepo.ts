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
       (id, user_id, name, kind, scopes, token_hash, prefix, created_at, last_used_at, expires_at,
        oauth_client_id, refresh_hash, access_expires_at)
     VALUES (@id, @userId, @name, @kind, @scopes, @tokenHash, @prefix, @createdAt, @lastUsedAt, @expiresAt,
        @oauthClientId, @refreshHash, @accessExpiresAt)`,
  );
  const byRefreshStmt = db.prepare(
    `SELECT ${API_TOKEN_COLUMNS} FROM api_tokens WHERE refresh_hash = ?`,
  );
  const byPreviousRefreshStmt = db.prepare(
    `SELECT ${API_TOKEN_COLUMNS} FROM api_tokens WHERE previous_refresh_hash = ?`,
  );
  const rotateStmt = db.prepare(
    `UPDATE api_tokens
     SET previous_refresh_hash = refresh_hash, refresh_hash = @refreshHash,
         token_hash = @tokenHash, access_expires_at = @accessExpiresAt
     WHERE refresh_hash = @current`,
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
      insertStmt.run({
        ...input,
        scopes: JSON.stringify(input.scopes),
        oauthClientId: input.oauthClientId ?? null,
        refreshHash: input.refreshHash ?? null,
      });
    },
    async findByRefreshHash(refreshHash) {
      const row = byRefreshStmt.get(refreshHash) as ApiTokenRow | undefined;
      return row ? rowToApiToken(row) : null;
    },
    async findByPreviousRefreshHash(refreshHash) {
      const row = byPreviousRefreshStmt.get(refreshHash) as
        | ApiTokenRow
        | undefined;
      return row ? rowToApiToken(row) : null;
    },
    async rotate(current, next) {
      return rotateStmt.run({ ...next, current }).changes === 1;
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
