import { mergePrefs, parsePrefs } from "../prefsMapping.js";
import type { PrefsRepo } from "../types.js";
import type { PgPool } from "./database.js";

/**
 * See the SQLite copy. The row is created first if missing, so that the
 * `FOR UPDATE` that follows always has a row to lock: two devices sending at
 * once then merge one after the other instead of one overwriting the other.
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
  };
}
