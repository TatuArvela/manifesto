import {
  OAUTH_CLIENT_COLUMNS,
  OAUTH_CODE_COLUMNS,
  type OAuthClientRow,
  type OAuthCodeRow,
  rowToOAuthClient,
  rowToOAuthCode,
} from "../oauthMapping.js";
import type { OAuthRepo } from "../types.js";
import type { PgPool } from "./database.js";

export function createPostgresOAuthRepo(pool: PgPool): OAuthRepo {
  return {
    async createClient(client) {
      await pool.query(
        `INSERT INTO oauth_clients (${OAUTH_CLIENT_COLUMNS})
         VALUES ($1, $2, $3, $4, $5)`,
        [
          client.id,
          client.name,
          JSON.stringify(client.redirectUris),
          client.createdAt,
          client.lastUsedAt,
        ],
      );
    },
    async getClient(id) {
      const result = await pool.query<OAuthClientRow>(
        `SELECT ${OAUTH_CLIENT_COLUMNS} FROM oauth_clients WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      return row ? rowToOAuthClient(row) : null;
    },
    async touchClient(id, lastUsedAt) {
      await pool.query(
        `UPDATE oauth_clients SET last_used_at = $1 WHERE id = $2`,
        [lastUsedAt, id],
      );
    },
    async deleteUnusedClients(createdBefore) {
      const result = await pool.query(
        `DELETE FROM oauth_clients WHERE last_used_at IS NULL AND created_at < $1`,
        [createdBefore],
      );
      return result.rowCount ?? 0;
    },
    async createCode(code) {
      await pool.query(
        `INSERT INTO oauth_codes (${OAUTH_CODE_COLUMNS})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          code.codeHash,
          code.clientId,
          code.clientName,
          code.userId,
          code.redirectUri,
          code.codeChallenge,
          JSON.stringify(code.scopes),
          code.grantExpiresAt,
          code.expiresAt,
        ],
      );
    },
    async redeemCode(codeHash, nowIso) {
      const result = await pool.query<OAuthCodeRow>(
        `DELETE FROM oauth_codes WHERE code_hash = $1
         RETURNING ${OAUTH_CODE_COLUMNS}`,
        [codeHash],
      );
      const row = result.rows[0];
      if (!row || row.expires_at < nowIso) return null;
      return rowToOAuthCode(row);
    },
    async deleteExpiredCodes(nowIso) {
      const result = await pool.query(
        `DELETE FROM oauth_codes WHERE expires_at < $1`,
        [nowIso],
      );
      return result.rowCount ?? 0;
    },
  };
}
