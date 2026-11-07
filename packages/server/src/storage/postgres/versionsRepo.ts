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

/** See the SQLite copy: the same statements. */
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
      const inserted = await pool.query(
        `INSERT INTO note_versions
           (id, note_id, author_id, key_version, format, title, content,
            images, image_refs, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          input.id,
          input.noteId,
          input.authorId,
          input.keyVersion,
          input.format,
          input.title,
          input.content,
          input.images?.sealed ?? null,
          input.images ? JSON.stringify(input.images.refs) : null,
          input.createdAt,
        ],
      );
      if ((inserted.rowCount ?? 0) === 0) return false;
      const cutoff = new Date(
        Date.now() - NOTE_VERSION_MAX_AGE_DAYS * DAY_MS,
      ).toISOString();
      await pool.query(
        `DELETE FROM note_versions WHERE note_id = $1 AND created_at < $2`,
        [input.noteId, cutoff],
      );
      // All versions after the newest MAX_NOTE_VERSIONS.
      await pool.query(
        `DELETE FROM note_versions WHERE note_id = $1 AND id NOT IN (
           SELECT id FROM note_versions WHERE note_id = $1
           ORDER BY created_at DESC, id DESC LIMIT $2)`,
        [input.noteId, MAX_NOTE_VERSIONS],
      );
      return true;
    },
  };
}
