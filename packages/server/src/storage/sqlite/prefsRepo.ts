import { mergePrefs, parsePrefs } from "#/storage/prefsMapping.ts";
import type { PrefsRepo } from "#/storage/types.ts";
import type { SqliteDB } from "./database.ts";

export function createSqlitePrefsRepo(db: SqliteDB): PrefsRepo {
  const getStmt = db.prepare(`SELECT prefs FROM user_prefs WHERE user_id = ?`);
  const putStmt = db.prepare(
    `INSERT INTO user_prefs (user_id, prefs, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET prefs = excluded.prefs,
       updated_at = excluded.updated_at`,
  );
  const clearStmt = db.prepare(`DELETE FROM user_prefs WHERE user_id = ?`);
  const read = (userId: string) =>
    parsePrefs(
      (getStmt.get(userId) as { prefs: string } | undefined)?.prefs ?? null,
    );
  // One synchronous transaction. Nothing can occur between the read and the
  // write.
  const merge = db.transaction(
    (
      userId: string,
      patch: Record<string, unknown>,
      at: string,
      max: number,
    ) => {
      const merged = mergePrefs(read(userId), patch, max);
      if (merged === "tooLarge") return merged;
      putStmt.run(userId, merged.json, at);
      return merged.prefs;
    },
  );
  return {
    async get(userId) {
      return read(userId);
    },
    async merge(userId, patch, at, maxBytes) {
      return merge(userId, patch, at, maxBytes);
    },
    async clear(userId) {
      clearStmt.run(userId);
    },
  };
}
