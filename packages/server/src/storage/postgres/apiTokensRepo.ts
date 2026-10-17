import {
  API_TOKEN_COLUMNS,
  type ApiTokenRow,
  listedToken,
  rowToApiToken,
} from "#/storage/apiTokenMapping.js";
import type { ApiTokensRepo } from "#/storage/types.js";
import type { PgPool } from "./database.js";

export function createPostgresApiTokensRepo(pool: PgPool): ApiTokensRepo {
  return {
    async create(input) {
      await pool.query(
        `INSERT INTO api_tokens
           (id, user_id, name, kind, scopes, token_hash, prefix, created_at, last_used_at, expires_at,
            oauth_client_id, refresh_hash, access_expires_at, wrapped_keys,
            refresh_wrapped_keys)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          input.id,
          input.userId,
          input.name,
          input.kind,
          JSON.stringify(input.scopes),
          input.tokenHash,
          input.prefix,
          input.createdAt,
          input.lastUsedAt,
          input.expiresAt,
          input.oauthClientId ?? null,
          input.refreshHash ?? null,
          input.accessExpiresAt,
          input.wrappedKeys ?? null,
          input.refreshWrappedKeys ?? null,
        ],
      );
    },
    async findByRefreshHash(refreshHash) {
      const result = await pool.query<ApiTokenRow>(
        `SELECT ${API_TOKEN_COLUMNS} FROM api_tokens WHERE refresh_hash = $1`,
        [refreshHash],
      );
      const row = result.rows[0];
      return row ? rowToApiToken(row) : null;
    },
    async findByPreviousRefreshHash(refreshHash) {
      const result = await pool.query<ApiTokenRow>(
        `SELECT ${API_TOKEN_COLUMNS} FROM api_tokens
         WHERE previous_refresh_hash = $1`,
        [refreshHash],
      );
      const row = result.rows[0];
      return row ? rowToApiToken(row) : null;
    },
    async rotate(current, next) {
      const result = await pool.query(
        `UPDATE api_tokens
         SET previous_refresh_hash = refresh_hash, refresh_hash = $1,
             token_hash = $2, access_expires_at = $3,
             wrapped_keys = $5, refresh_wrapped_keys = $6
         WHERE refresh_hash = $4`,
        [
          next.refreshHash,
          next.tokenHash,
          next.accessExpiresAt,
          current,
          next.wrappedKeys,
          next.refreshWrappedKeys,
        ],
      );
      return result.rowCount === 1;
    },
    async findByHash(tokenHash) {
      const result = await pool.query<ApiTokenRow>(
        `SELECT ${API_TOKEN_COLUMNS} FROM api_tokens WHERE token_hash = $1`,
        [tokenHash],
      );
      const row = result.rows[0];
      return row ? rowToApiToken(row) : null;
    },
    async listByUser(userId) {
      const result = await pool.query<ApiTokenRow>(
        `SELECT ${API_TOKEN_COLUMNS} FROM api_tokens WHERE user_id = $1
         ORDER BY created_at DESC, id DESC`,
        [userId],
      );
      return result.rows.map(rowToApiToken).map(listedToken);
    },
    async delete(id, userId) {
      const result = await pool.query<{ token_hash: string }>(
        `DELETE FROM api_tokens WHERE id = $1 AND user_id = $2
         RETURNING token_hash`,
        [id, userId],
      );
      return result.rows[0]?.token_hash ?? null;
    },
    async deleteByUser(userId) {
      const result = await pool.query(
        `DELETE FROM api_tokens WHERE user_id = $1`,
        [userId],
      );
      return result.rowCount ?? 0;
    },
    async touch(id, lastUsedAt) {
      await pool.query(
        `UPDATE api_tokens SET last_used_at = $1 WHERE id = $2`,
        [lastUsedAt, id],
      );
    },
    async deleteExpired(nowIso) {
      const result = await pool.query(
        `DELETE FROM api_tokens WHERE expires_at IS NOT NULL AND expires_at < $1`,
        [nowIso],
      );
      return result.rowCount ?? 0;
    },
  };
}
