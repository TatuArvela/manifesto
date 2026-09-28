import {
  OAUTH_CLIENT_COLUMNS,
  OAUTH_CODE_COLUMNS,
  type OAuthClientRow,
  type OAuthCodeRow,
  rowToOAuthClient,
  rowToOAuthCode,
} from "../oauthMapping.js";
import type { OAuthRepo } from "../types.js";
import type { SqliteDB } from "./database.js";

export function createSqliteOAuthRepo(db: SqliteDB): OAuthRepo {
  const insertClientStmt = db.prepare(
    `INSERT INTO oauth_clients (${OAUTH_CLIENT_COLUMNS})
     VALUES (@id, @name, @redirectUris, @createdAt, @lastUsedAt)`,
  );
  const clientStmt = db.prepare(
    `SELECT ${OAUTH_CLIENT_COLUMNS} FROM oauth_clients WHERE id = ?`,
  );
  const touchClientStmt = db.prepare(
    `UPDATE oauth_clients SET last_used_at = ? WHERE id = ?`,
  );
  const unusedClientsStmt = db.prepare(
    `DELETE FROM oauth_clients WHERE last_used_at IS NULL AND created_at < ?`,
  );
  const insertCodeStmt = db.prepare(
    `INSERT INTO oauth_codes (${OAUTH_CODE_COLUMNS})
     VALUES (@codeHash, @clientId, @clientName, @userId, @redirectUri,
             @codeChallenge, @scopes, @grantExpiresAt, @expiresAt)`,
  );
  const redeemStmt = db.prepare(
    `DELETE FROM oauth_codes WHERE code_hash = ? RETURNING ${OAUTH_CODE_COLUMNS}`,
  );
  const expiredCodesStmt = db.prepare(
    `DELETE FROM oauth_codes WHERE expires_at < ?`,
  );

  return {
    async createClient(client) {
      insertClientStmt.run({
        ...client,
        redirectUris: JSON.stringify(client.redirectUris),
      });
    },
    async getClient(id) {
      const row = clientStmt.get(id) as OAuthClientRow | undefined;
      return row ? rowToOAuthClient(row) : null;
    },
    async touchClient(id, lastUsedAt) {
      touchClientStmt.run(lastUsedAt, id);
    },
    async deleteUnusedClients(createdBefore) {
      return unusedClientsStmt.run(createdBefore).changes;
    },
    async createCode(code) {
      insertCodeStmt.run({ ...code, scopes: JSON.stringify(code.scopes) });
    },
    async redeemCode(codeHash, nowIso) {
      const row = redeemStmt.get(codeHash) as OAuthCodeRow | undefined;
      if (!row || row.expires_at < nowIso) return null;
      return rowToOAuthCode(row);
    },
    async deleteExpiredCodes(nowIso) {
      return expiredCodesStmt.run(nowIso).changes;
    },
  };
}
