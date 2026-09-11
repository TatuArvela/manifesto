import type { Note, NoteUpdate } from "@manifesto/shared";
import {
  INSERT_COLUMNS,
  type NoteRow,
  noteInsertValues,
  noteUpdateColumns,
  rowToNote,
  searchPattern,
} from "../noteMapping.js";
import type { InsertNoteInput, NotesRepo } from "../types.js";
import type { PgPool } from "./database.js";

export function createPostgresNotesRepo(pool: PgPool): NotesRepo {
  const repo: NotesRepo = {
    async listByUser(userId: string): Promise<Note[]> {
      const result = await pool.query<NoteRow>(
        `SELECT * FROM notes WHERE user_id = $1 ORDER BY updated_at DESC`,
        [userId],
      );
      return result.rows.map(rowToNote);
    },

    async getById(id: string, userId: string): Promise<Note | null> {
      const result = await pool.query<NoteRow>(
        `SELECT * FROM notes WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      const row = result.rows[0];
      return row ? rowToNote(row) : null;
    },

    async insert(input: InsertNoteInput): Promise<Note> {
      await pool.query(
        `INSERT INTO notes (${INSERT_COLUMNS.join(", ")})
         VALUES (${INSERT_COLUMNS.map((_, i) => `$${i + 1}`).join(", ")})`,
        noteInsertValues(input, "native"),
      );
      const note = await repo.getById(input.id, input.userId);
      if (!note)
        throw new Error(`Failed to retrieve inserted note ${input.id}`);
      return note;
    },

    async update(
      id: string,
      userId: string,
      changes: NoteUpdate,
      updatedAt: string,
      expectedUpdatedAt?: string,
    ): Promise<Note | null> {
      const { columns, values } = noteUpdateColumns(changes, "native");
      const params = [...values, updatedAt, id, userId];
      const assignments = [...columns, "updated_at"].map(
        (column, i) => `${column} = $${i + 1}`,
      );
      const idParam = params.length - 1;
      // Compare-and-set on `updated_at` when the caller passed `If-Match` —
      // collapses the prior read-then-write race into a single atomic write.
      let where = `WHERE id = $${idParam} AND user_id = $${idParam + 1}`;
      if (expectedUpdatedAt !== undefined) {
        params.push(expectedUpdatedAt);
        where += ` AND updated_at = $${params.length}`;
      }
      const sql = `UPDATE notes SET ${assignments.join(", ")} ${where}`;
      const result = await pool.query(sql, params);
      if ((result.rowCount ?? 0) === 0) return null;
      return await repo.getById(id, userId);
    },

    async delete(id: string, userId: string): Promise<boolean> {
      const result = await pool.query(
        `DELETE FROM notes WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async search(userId: string, query: string): Promise<Note[]> {
      const like = searchPattern(query);
      if (like === null) return [];
      const result = await pool.query<NoteRow>(
        `SELECT * FROM notes
         WHERE user_id = $1
           AND (LOWER(title) LIKE LOWER($2) OR LOWER(content) LIKE LOWER($3))
         ORDER BY updated_at DESC`,
        [userId, like, like],
      );
      return result.rows.map(rowToNote);
    },
  };

  return repo;
}
