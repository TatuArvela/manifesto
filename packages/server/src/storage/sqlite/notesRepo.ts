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
import type { SqliteDB } from "./database.js";

export function createSqliteNotesRepo(db: SqliteDB): NotesRepo {
  const listStmt = db.prepare(
    `SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC`,
  );
  const getStmt = db.prepare(
    `SELECT * FROM notes WHERE id = ? AND user_id = ?`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO notes (${INSERT_COLUMNS.join(", ")})
     VALUES (${INSERT_COLUMNS.map(() => "?").join(", ")})`,
  );
  const deleteStmt = db.prepare(
    `DELETE FROM notes WHERE id = ? AND user_id = ?`,
  );
  const searchStmt = db.prepare(
    `SELECT * FROM notes
     WHERE user_id = ?
       AND (LOWER(title) LIKE LOWER(?) OR LOWER(content) LIKE LOWER(?))
     ORDER BY updated_at DESC`,
  );

  const repo: NotesRepo = {
    async listByUser(userId: string): Promise<Note[]> {
      const rows = listStmt.all(userId) as NoteRow[];
      return rows.map(rowToNote);
    },

    async getById(id: string, userId: string): Promise<Note | null> {
      const row = getStmt.get(id, userId) as NoteRow | undefined;
      return row ? rowToNote(row) : null;
    },

    async insert(input: InsertNoteInput): Promise<Note> {
      insertStmt.run(noteInsertValues(input, "integer"));
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
      const { columns, values } = noteUpdateColumns(changes, "integer");
      const assignments = [...columns, "updated_at"].map(
        (column) => `${column} = ?`,
      );
      const params = [...values, updatedAt, id, userId];
      // Compare-and-set on `updated_at` when the caller passed `If-Match` —
      // collapses the prior read-then-write race into a single atomic write.
      let where = `WHERE id = ? AND user_id = ?`;
      if (expectedUpdatedAt !== undefined) {
        where += ` AND updated_at = ?`;
        params.push(expectedUpdatedAt);
      }
      const sql = `UPDATE notes SET ${assignments.join(", ")} ${where}`;
      const info = db.prepare(sql).run(params);
      if (info.changes === 0) return null;
      return await repo.getById(id, userId);
    },

    async delete(id: string, userId: string): Promise<boolean> {
      const info = deleteStmt.run(id, userId);
      return info.changes > 0;
    },

    async search(userId: string, query: string): Promise<Note[]> {
      const like = searchPattern(query);
      if (like === null) return [];
      const rows = searchStmt.all(userId, like, like) as NoteRow[];
      return rows.map(rowToNote);
    },
  };

  return repo;
}
