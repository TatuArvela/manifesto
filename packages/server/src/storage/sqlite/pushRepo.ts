import {
  PUSH_COLUMNS,
  type PushRow,
  rowToPushSubscription,
} from "../pushMapping.js";
import type { PushSubscriptionsRepo, ServerSecretsRepo } from "../types.js";
import type { SqliteDB } from "./database.js";

export function createSqlitePushSubscriptionsRepo(
  db: SqliteDB,
): PushSubscriptionsRepo {
  const dropEndpointStmt = db.prepare(
    `DELETE FROM push_subscriptions WHERE endpoint = ?`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO push_subscriptions (${PUSH_COLUMNS})
     VALUES (@id, @userId, @sessionToken, @endpoint, @p256dh, @auth, @createdAt,
             @failureCount)`,
  );
  const save = db.transaction((subscription: Record<string, unknown>) => {
    dropEndpointStmt.run(subscription.endpoint);
    insertStmt.run(subscription);
  });
  const byUserStmt = db.prepare(
    `SELECT ${PUSH_COLUMNS} FROM push_subscriptions WHERE user_id = ?
     ORDER BY created_at, id`,
  );
  const usersStmt = db.prepare(
    `SELECT DISTINCT user_id FROM push_subscriptions`,
  );
  const deleteEndpointStmt = db.prepare(
    `DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?`,
  );
  const deleteStmt = db.prepare(`DELETE FROM push_subscriptions WHERE id = ?`);
  const deleteByUserStmt = db.prepare(
    `DELETE FROM push_subscriptions WHERE user_id = ?`,
  );
  const failStmt = db.prepare(
    `UPDATE push_subscriptions SET failure_count = failure_count + 1
     WHERE id = ? RETURNING failure_count`,
  );
  const successStmt = db.prepare(
    `UPDATE push_subscriptions SET failure_count = 0 WHERE id = ?`,
  );
  return {
    async save(subscription) {
      save({ ...subscription });
    },
    async listByUser(userId) {
      return (byUserStmt.all(userId) as PushRow[]).map(rowToPushSubscription);
    },
    async userIds() {
      return (usersStmt.all() as { user_id: string }[]).map((r) => r.user_id);
    },
    async deleteByEndpoint(endpoint, userId) {
      return deleteEndpointStmt.run(endpoint, userId).changes > 0;
    },
    async delete(id) {
      return deleteStmt.run(id).changes > 0;
    },
    async deleteByUser(userId) {
      return deleteByUserStmt.run(userId).changes;
    },
    async recordFailure(id) {
      const row = failStmt.get(id) as { failure_count: number } | undefined;
      return row?.failure_count ?? 0;
    },
    async recordSuccess(id) {
      successStmt.run(id);
    },
  };
}

export function createSqliteServerSecretsRepo(db: SqliteDB): ServerSecretsRepo {
  const getStmt = db.prepare(`SELECT value FROM server_secrets WHERE name = ?`);
  const insertStmt = db.prepare(
    `INSERT INTO server_secrets (name, value, created_at) VALUES (?, ?, ?)
     ON CONFLICT (name) DO NOTHING`,
  );
  const read = (name: string) =>
    (getStmt.get(name) as { value: string } | undefined)?.value ?? null;
  return {
    async get(name) {
      return read(name);
    },
    async setIfAbsent(name, value, now) {
      insertStmt.run(name, value, now);
      return read(name) ?? value;
    },
  };
}
