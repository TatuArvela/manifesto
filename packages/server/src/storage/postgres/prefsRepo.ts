import { mergePrefs, parsePrefs } from "#/storage/prefsMapping.ts";
import type { PrefsRepo } from "#/storage/types.ts";
import type { PgPool } from "./database.ts";

/**
 * See the SQLite copy. The code creates the row first if it is missing. Thus,
 * the `FOR UPDATE` that follows always has a row to lock. Two devices that send
 * at the same time then merge one after the other. One does not overwrite the
 * other.
 */
export function createPostgresPrefsRepo(pool: PgPool): PrefsRepo {
  return {
    async get(userId) {
      const result = await pool.query<{ prefs: string }>(
        `SELECT prefs FROM user_prefs WHERE user_id = $1`,
        [userId],
      );
      return parsePrefs(result.rows[0]?.prefs);
    },
    async merge(userId, patch, at, maxBytes) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO user_prefs (user_id, prefs, updated_at)
           VALUES ($1, '{}', $2) ON CONFLICT (user_id) DO NOTHING`,
          [userId, at],
        );
        const found = await client.query<{ prefs: string }>(
          `SELECT prefs FROM user_prefs WHERE user_id = $1 FOR UPDATE`,
          [userId],
        );
        const merged = mergePrefs(
          parsePrefs(found.rows[0]?.prefs),
          patch,
          maxBytes,
        );
        if (merged === "tooLarge") {
          await client.query("ROLLBACK");
          return merged;
        }
        await client.query(
          `UPDATE user_prefs SET prefs = $1, updated_at = $2 WHERE user_id = $3`,
          [merged.json, at, userId],
        );
        await client.query("COMMIT");
        return merged.prefs;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async clear(userId) {
      await pool.query(`DELETE FROM user_prefs WHERE user_id = $1`, [userId]);
    },
  };
}
