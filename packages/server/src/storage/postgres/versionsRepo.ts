import {
  MAX_NOTE_VERSIONS,
  NOTE_VERSION_MAX_AGE_DAYS,
} from "@manifesto/shared";
import { rowToVersion } from "../sqlite/versionsRepo.js";
import type { VersionsRepo } from "../types.js";
import type { PgPool } from "./database.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** See the SQLite copy. The trim reads the ids to keep first, since pg-mem
 * is unreliable about `NOT IN` over a subquery with `LIMIT`. */
export function createPostgresVersionsRepo(pool: PgPool): VersionsRepo {
  return {
    async list(noteId) {
      const result = await pool.query(
        `SELECT note_id, title, content, created_at FROM note_versions
         WHERE note_id = $1 ORDER BY created_at DESC, id DESC`,
        [noteId],
      );
      return result.rows.map(rowToVersion);
    },

    async add(input) {
      await pool.query(
        `INSERT INTO note_versions (id, note_id, author_id, title, content, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.id,
          input.noteId,
          input.authorId,
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
    },
  };
}
