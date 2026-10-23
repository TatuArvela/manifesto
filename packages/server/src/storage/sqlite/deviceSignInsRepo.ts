import type { DeviceSignInsRepo } from "#/storage/types.ts";
import type { SqliteDB } from "./database.ts";

interface ClaimedRow {
  user_id: string;
  key_ephemeral: string | null;
  key_wrapped: string | null;
}

export function createSqliteDeviceSignInsRepo(db: SqliteDB): DeviceSignInsRepo {
  const insertStmt = db.prepare(
    `INSERT INTO device_sign_ins
       (id_hash, wait_hash, user_agent, created_at, expires_at)
     VALUES (@idHash, @waitHash, @userAgent, @createdAt, @expiresAt)`,
  );
  const findStmt = db.prepare(
    `SELECT user_agent, created_at, expires_at FROM device_sign_ins
     WHERE id_hash = @idHash AND approved_at IS NULL AND used_at IS NULL
       AND expires_at > @now`,
  );
  const approveStmt = db.prepare(
    `UPDATE device_sign_ins
     SET user_id = @userId, key_ephemeral = @ephemeral, key_wrapped = @wrapped,
         approved_at = @now
     WHERE id_hash = @idHash AND approved_at IS NULL AND used_at IS NULL
       AND expires_at > @now`,
  );
  const denyStmt = db.prepare(
    `UPDATE device_sign_ins SET used_at = @now
     WHERE id_hash = @idHash AND approved_at IS NULL AND used_at IS NULL
       AND expires_at > @now`,
  );
  const claimStmt = db.prepare(
    `UPDATE device_sign_ins SET used_at = @now
     WHERE wait_hash = @waitHash AND approved_at IS NOT NULL
       AND used_at IS NULL AND expires_at > @now
     RETURNING user_id, key_ephemeral, key_wrapped`,
  );
  const pendingStmt = db.prepare(
    `SELECT 1 FROM device_sign_ins
     WHERE wait_hash = @waitHash AND approved_at IS NULL AND used_at IS NULL
       AND expires_at > @now`,
  );
  const deleteByUserStmt = db.prepare(
    `DELETE FROM device_sign_ins WHERE user_id = ? AND used_at IS NULL`,
  );
  const expireStmt = db.prepare(
    `DELETE FROM device_sign_ins WHERE expires_at < ?`,
  );
  return {
    async create(input) {
      insertStmt.run(input);
    },
    async find(idHash, now) {
      const row = findStmt.get({ idHash, now }) as
        | { user_agent: string; created_at: string; expires_at: string }
        | undefined;
      return row
        ? {
            userAgent: row.user_agent,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
          }
        : null;
    },
    async approve(idHash, userId, key, now) {
      return (
        approveStmt.run({
          idHash,
          userId,
          ephemeral: key?.ephemeral ?? null,
          wrapped: key?.wrapped ?? null,
          now,
        }).changes === 1
      );
    },
    async deny(idHash, now) {
      return denyStmt.run({ idHash, now }).changes === 1;
    },
    async claim(waitHash, now) {
      const row = claimStmt.get({ waitHash, now }) as ClaimedRow | undefined;
      if (row) {
        return {
          userId: row.user_id,
          key:
            row.key_ephemeral !== null && row.key_wrapped !== null
              ? { ephemeral: row.key_ephemeral, wrapped: row.key_wrapped }
              : null,
        };
      }
      return pendingStmt.get({ waitHash, now }) ? "pending" : null;
    },
    async deleteByUser(userId) {
      return deleteByUserStmt.run(userId).changes;
    },
    async deleteExpired(now) {
      return expireStmt.run(now).changes;
    },
  };
}
