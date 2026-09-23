import {
  API_TOKEN_COLUMNS,
  type ApiTokenRow,
  listedToken,
  rowToApiToken,
} from "../apiTokenMapping.js";
import type { ApiTokensRepo } from "../types.js";
import type { PgPool } from "./database.js";

export function createPostgresApiTokensRepo(pool: PgPool): ApiTokensRepo {
  return {
    async create(input) {
      await pool.query(
        `INSERT INTO api_tokens
           (id, user_id, name, token_hash, prefix, created_at, last_used_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          input.id,
          input.userId,
          input.name,
          input.tokenHash,
          input.prefix,
          input.createdAt,
          input.lastUsedAt,
          input.expiresAt,
        ],
      );
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
