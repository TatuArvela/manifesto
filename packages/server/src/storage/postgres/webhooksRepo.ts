import type { WebhooksRepo } from "../types.js";
import { rowToWebhook, type WebhookRow } from "../webhookMapping.js";
import type { PgPool } from "./database.js";

/** See the SQLite copy. The failure count is read, then written, rather than
 * computed in one `CASE`, which pg-mem handles unreliably; a webhook's
 * deliveries are serialised by the dispatcher, so nothing races it. */
export function createPostgresWebhooksRepo(pool: PgPool): WebhooksRepo {
  return {
    async create(input) {
      await pool.query(
        `INSERT INTO webhooks (id, user_id, url, secret, events, active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.id,
          input.userId,
          input.url,
          input.secret,
          JSON.stringify(input.events),
          input.active,
          input.createdAt,
        ],
      );
    },
    async listByUser(userId) {
      const result = await pool.query<WebhookRow>(
        `SELECT * FROM webhooks WHERE user_id = $1 ORDER BY created_at, id`,
        [userId],
      );
      return result.rows.map(rowToWebhook);
    },
    async activeFor(userId, event) {
      const result = await pool.query<WebhookRow>(
        `SELECT * FROM webhooks WHERE user_id = $1 AND active = TRUE`,
        [userId],
      );
      return result.rows
        .map(rowToWebhook)
        .filter((w) => w.events.includes(event));
    },
    async get(id, userId) {
      const result = await pool.query<WebhookRow>(
        `SELECT * FROM webhooks WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      const row = result.rows[0];
      return row ? rowToWebhook(row) : null;
    },
    async delete(id, userId) {
      const result = await pool.query(
        `DELETE FROM webhooks WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async setActive(id, userId, active) {
      const result = await pool.query(
        `UPDATE webhooks SET active = $1, failure_count = 0
         WHERE id = $2 AND user_id = $3`,
        [active, id, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async recordDelivery(id, result) {
      const current = await pool.query<{ failure_count: number | string }>(
        `SELECT failure_count FROM webhooks WHERE id = $1`,
        [id],
      );
      const row = current.rows[0];
      if (!row) return;
      const failures = result.failed ? Number(row.failure_count) + 1 : 0;
      await pool.query(
        `UPDATE webhooks SET last_delivery_at = $1, last_status = $2,
           last_error = $3, failure_count = $4,
           active = CASE WHEN $5 THEN FALSE ELSE active END
         WHERE id = $6`,
        [
          result.at,
          result.status,
          result.error,
          failures,
          failures >= result.disableAfter,
          id,
        ],
      );
    },
  };
}
