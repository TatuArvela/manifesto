import type { Note, NoteUpdate } from "@manifesto/shared";
import {
  decodeCursor,
  INSERT_COLUMNS,
  type NoteRow,
  noteInsertValues,
  noteUpdateColumns,
  rowToNote,
  searchPattern,
  takePage,
} from "../noteMapping.js";
import type {
  InsertNoteInput,
  ListNotesOptions,
  NotePage,
  NotesRepo,
} from "../types.js";
import type { PgPool } from "./database.js";

/** See the SQLite copy — same columns, same ordering, same reasons. */
const LIST_COLUMNS = INSERT_COLUMNS.filter((c) => c !== "images").join(", ");

export function createPostgresNotesRepo(pool: PgPool): NotesRepo {
  const repo: NotesRepo = {
    async listByUser(
      userId: string,
      { limit, cursor }: ListNotesOptions,
    ): Promise<NotePage> {
      const after = cursor ? decodeCursor(cursor) : null;
      // One more than asked for, so the presence of a next page is a fact
      // about the rows rather than a second COUNT query.
      const result = after
        ? await pool.query<NoteRow>(
            `SELECT ${LIST_COLUMNS} FROM notes
             WHERE user_id = $1
               AND (updated_at < $2 OR (updated_at = $2 AND id < $3))
             ORDER BY updated_at DESC, id DESC LIMIT $4`,
            [userId, after.updatedAt, after.id, limit + 1],
          )
        : await pool.query<NoteRow>(
            `SELECT ${LIST_COLUMNS} FROM notes WHERE user_id = $1
             ORDER BY updated_at DESC, id DESC LIMIT $2`,
            [userId, limit + 1],
          );
      return takePage(result.rows, limit);
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

    async search(
      userId: string,
      query: string,
      { limit, cursor }: ListNotesOptions,
    ): Promise<NotePage> {
      const like = searchPattern(query);
      if (like === null) return { notes: [], nextCursor: null };
      const after = cursor ? decodeCursor(cursor) : null;
      const matches = `WHERE user_id = $1
           AND (LOWER(title) LIKE LOWER($2) OR LOWER(content) LIKE LOWER($3))`;
      const result = after
        ? await pool.query<NoteRow>(
            `SELECT ${LIST_COLUMNS} FROM notes ${matches}
             AND (updated_at < $4 OR (updated_at = $4 AND id < $5))
             ORDER BY updated_at DESC, id DESC LIMIT $6`,
            [userId, like, like, after.updatedAt, after.id, limit + 1],
          )
        : await pool.query<NoteRow>(
            `SELECT ${LIST_COLUMNS} FROM notes ${matches}
             ORDER BY updated_at DESC, id DESC LIMIT $4`,
            [userId, like, like, limit + 1],
          );
      return takePage(result.rows, limit);
    },
  };

  return repo;
}
