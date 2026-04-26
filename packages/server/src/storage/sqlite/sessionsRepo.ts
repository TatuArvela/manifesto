import type { CreateSessionInput, Session, SessionsRepo } from "../types.js";
import type { SqliteDB } from "./database.js";

interface SessionRow {
  token: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

function rowToSession(row: SessionRow): Session {
  return {
    token: row.token,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function createSqliteSessionsRepo(db: SqliteDB): SessionsRepo {
  const insertStmt = db.prepare(
    `INSERT INTO sessions (token, user_id, created_at, expires_at, last_seen_at)
     VALUES (@token, @userId, @createdAt, @expiresAt, @lastSeenAt)`,
  );
  const findStmt = db.prepare(`SELECT * FROM sessions WHERE token = ?`);
  const deleteStmt = db.prepare(`DELETE FROM sessions WHERE token = ?`);
  const deleteExpiredStmt = db.prepare(
    `DELETE FROM sessions WHERE expires_at < ?`,
  );
  const touchStmt = db.prepare(
    `UPDATE sessions SET last_seen_at = @lastSeenAt, expires_at = @expiresAt
     WHERE token = @token`,
  );

  return {
    async create(input: CreateSessionInput): Promise<Session> {
      insertStmt.run(input);
      return rowToSession(findStmt.get(input.token) as SessionRow);
    },

    async findByToken(token: string): Promise<Session | null> {
      const row = findStmt.get(token) as SessionRow | undefined;
      return row ? rowToSession(row) : null;
    },

    async deleteByToken(token: string): Promise<void> {
      deleteStmt.run(token);
    },

    async deleteExpired(nowIso: string): Promise<number> {
      const info = deleteExpiredStmt.run(nowIso);
      return info.changes;
    },

    async touch(
      token: string,
      lastSeenAt: string,
      expiresAt: string,
    ): Promise<void> {
      touchStmt.run({ token, lastSeenAt, expiresAt });
    },
  };
}
