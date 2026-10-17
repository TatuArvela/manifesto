import {
  MAX_NOTE_VERSIONS,
  NOTE_VERSION_MAX_AGE_DAYS,
} from "@manifesto/shared";
import {
  rowToVersion,
  VERSION_COLUMNS,
} from "#/storage/sqlite/versionsRepo.ts";
import type { VersionsRepo } from "#/storage/types.ts";
import type { PgPool } from "./database.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** See the SQLite copy. The trim reads the ids to keep first, since pg-mem
 * is unreliable about `NOT IN` over a subquery with `LIMIT`. */
export function createPostgresVersionsRepo(pool: PgPool): VersionsRepo {
  return {
    async list(noteId) {
      const result = await pool.query(
        `SELECT ${VERSION_COLUMNS} FROM note_versions
         WHERE note_id = $1 ORDER BY created_at DESC, id DESC`,
        [noteId],
      );
      return result.rows.map(rowToVersion);
    },

    async add(input) {
      // Asked first rather than left to `ON CONFLICT`, whose row count
      // pg-mem gets wrong; the id is a ULID the writer just made, so the
      // race this leaves is with itself.
      const taken = await pool.query(
        `SELECT 1 FROM note_versions WHERE id = $1`,
        [input.id],
      );
      if (taken.rows.length > 0) return false;
      await pool.query(
        `INSERT INTO note_versions
           (id, note_id, author_id, key_version, title, content, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.id,
          input.noteId,
          input.authorId,
          input.keyVersion,
          input.title,
          input.content,
          input.createdAt,
        ],
      );
      const cutoff = new Date(
        Date.now() - NOTE_VERSION_MAX_AGE_DAYS * DAY_MS,
      ).toISOString();
      await pool.query(
        `DELETE FROM note_versions WHERE note_id = $1 AND created_at < $2`,
        [input.noteId, cutoff],
      );
      const beyond = await pool.query<{ id: string }>(
        `SELECT id FROM note_versions WHERE note_id = $1
         ORDER BY created_at DESC, id DESC OFFSET $2`,
        [input.noteId, MAX_NOTE_VERSIONS],
      );
      for (const { id } of beyond.rows) {
        await pool.query(`DELETE FROM note_versions WHERE id = $1`, [id]);
      }
      return true;
    },
  };
}
