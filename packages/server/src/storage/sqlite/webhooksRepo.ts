import type { WebhooksRepo } from "../types.js";
import { rowToWebhook, type WebhookRow } from "../webhookMapping.js";
import type { SqliteDB } from "./database.js";

export function createSqliteWebhooksRepo(db: SqliteDB): WebhooksRepo {
  const insertStmt = db.prepare(
    `INSERT INTO webhooks (id, user_id, url, secret, events, active, created_at)
     VALUES (@id, @userId, @url, @secret, @events, @active, @createdAt)`,
  );
  const byUserStmt = db.prepare(
    `SELECT * FROM webhooks WHERE user_id = ? ORDER BY created_at, id`,
  );
  const activeStmt = db.prepare(
    `SELECT * FROM webhooks WHERE user_id = ? AND active = 1`,
  );
  const getStmt = db.prepare(
    `SELECT * FROM webhooks WHERE id = ? AND user_id = ?`,
  );
  const deleteStmt = db.prepare(
    `DELETE FROM webhooks WHERE id = ? AND user_id = ?`,
  );
  const setActiveStmt = db.prepare(
    `UPDATE webhooks SET active = ?, failure_count = 0
     WHERE id = ? AND user_id = ?`,
  );
  const recordStmt = db.prepare(
    `UPDATE webhooks SET last_delivery_at = @at, last_status = @status,
       last_error = @error,
       failure_count = CASE WHEN @failed = 1 THEN failure_count + 1 ELSE 0 END,
       active = CASE WHEN @failed = 1 AND failure_count + 1 >= @disableAfter
                     THEN 0 ELSE active END
     WHERE id = @id`,
  );

  return {
    async create(input) {
      insertStmt.run({
        ...input,
        events: JSON.stringify(input.events),
        active: input.active ? 1 : 0,
      });
    },
    async listByUser(userId) {
      return (byUserStmt.all(userId) as WebhookRow[]).map(rowToWebhook);
    },
    async activeFor(userId, event) {
      return (activeStmt.all(userId) as WebhookRow[])
        .map(rowToWebhook)
        .filter((w) => w.events.includes(event));
    },
    async get(id, userId) {
      const row = getStmt.get(id, userId) as WebhookRow | undefined;
      return row ? rowToWebhook(row) : null;
    },
    async delete(id, userId) {
      return deleteStmt.run(id, userId).changes > 0;
    },
    async setActive(id, userId, active) {
      return setActiveStmt.run(active ? 1 : 0, id, userId).changes > 0;
    },
    async recordDelivery(id, result) {
      recordStmt.run({ id, ...result, failed: result.failed ? 1 : 0 });
    },
  };
}
