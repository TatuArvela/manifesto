import { AT_REST, atRest } from "#/storage/atRest.ts";
import {
  PUSH_COLUMNS,
  type PushRow,
  rowToPushSubscription,
  sealedSubscription,
} from "#/storage/pushMapping.ts";
import type {
  PushSubscriptionsRepo,
  ServerSecretsRepo,
} from "#/storage/types.ts";
import type { PgPool } from "./database.ts";

/** See the SQLite copy. The failure count is read after it is written rather
 * than returned by the update, as the webhooks' is, for pg-mem's sake. */
export function createPostgresPushSubscriptionsRepo(
  pool: PgPool,
): PushSubscriptionsRepo {
  return {
    async save(given) {
      const subscription = sealedSubscription(given);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `DELETE FROM push_subscriptions WHERE endpoint = $1`,
          [subscription.endpoint],
        );
        await client.query(
          `INSERT INTO push_subscriptions (${PUSH_COLUMNS})
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            subscription.id,
            subscription.userId,
            subscription.sessionToken,
            subscription.endpoint,
            subscription.p256dh,
            subscription.auth,
            subscription.createdAt,
            subscription.failureCount,
          ],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    async listByUser(userId) {
      const result = await pool.query<PushRow>(
        `SELECT ${PUSH_COLUMNS} FROM push_subscriptions WHERE user_id = $1
         ORDER BY created_at, id`,
        [userId],
      );
      return result.rows.map(rowToPushSubscription);
    },
    async userIds() {
      const result = await pool.query<{ user_id: string }>(
        `SELECT DISTINCT user_id FROM push_subscriptions`,
      );
      return result.rows.map((row) => row.user_id);
    },
    async deleteByEndpoint(endpoint, userId) {
      const result = await pool.query(
        `DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`,
        [endpoint, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async delete(id) {
      const result = await pool.query(
        `DELETE FROM push_subscriptions WHERE id = $1`,
        [id],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async deleteByUser(userId) {
      const result = await pool.query(
        `DELETE FROM push_subscriptions WHERE user_id = $1`,
        [userId],
      );
      return result.rowCount ?? 0;
    },
    async recordFailure(id) {
      await pool.query(
        `UPDATE push_subscriptions SET failure_count = failure_count + 1
         WHERE id = $1`,
        [id],
      );
      const result = await pool.query<{ failure_count: number }>(
        `SELECT failure_count FROM push_subscriptions WHERE id = $1`,
        [id],
      );
      return Number(result.rows[0]?.failure_count ?? 0);
    },
    async recordSuccess(id) {
      await pool.query(
        `UPDATE push_subscriptions SET failure_count = 0 WHERE id = $1`,
        [id],
      );
    },
  };
}

export function createPostgresServerSecretsRepo(
  pool: PgPool,
): ServerSecretsRepo {
  const stored = async (name: string) => {
    const result = await pool.query<{ value: string }>(
      `SELECT value FROM server_secrets WHERE name = $1`,
      [name],
    );
    return result.rows[0]?.value;
  };
  const read = async (name: string) => {
    const held = await stored(name);
    return held === undefined ? null : atRest.open(held, AT_REST.serverSecret);
  };
  return {
    get: read,
    async setIfAbsent(name, value, now) {
      const sealed = atRest.seal(value, AT_REST.serverSecret);
      await pool.query(
        `INSERT INTO server_secrets (name, value, created_at)
         VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`,
        [name, sealed, now],
      );
      const held = await read(name);
      if (held !== null) return held;
      // What the name holds does not open. Only if it is still that value,
      // so that of two processes that find it so, one's is kept by both.
      await pool.query(
        `UPDATE server_secrets SET value = $1, created_at = $2
         WHERE name = $3 AND value = $4`,
        [sealed, now, name, await stored(name)],
      );
      return (await read(name)) ?? value;
    },
  };
}
