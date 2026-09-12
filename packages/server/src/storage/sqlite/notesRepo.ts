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
import type { SqliteDB } from "./database.js";

/**
 * Everything but the attachments. Listing queries select this so the bytes
 * never leave the database, which is the point of leaving them out of the
 * response.
 */
const LIST_COLUMNS = INSERT_COLUMNS.filter((c) => c !== "images").join(", ");

/**
 * Ordered by `updated_at DESC, id DESC`, so a cursor is a place in a total
 * order rather than a timestamp two notes might share. Written as two
 * comparisons rather than a row value because pg-mem, which the parallel
 * Postgres suite runs on, does not parse `(a, b) < (c, d)`, and both drivers
 * should be reading the same shape of query.
 */
const PAGE_ORDER = `ORDER BY updated_at DESC, id DESC LIMIT ?`;
const AFTER_CURSOR = `AND (updated_at < ? OR (updated_at = ? AND id < ?))`;

export function createSqliteNotesRepo(db: SqliteDB): NotesRepo {
  const listStmt = db.prepare(
    `SELECT ${LIST_COLUMNS} FROM notes WHERE user_id = ? ${PAGE_ORDER}`,
  );
  const listAfterStmt = db.prepare(
    `SELECT ${LIST_COLUMNS} FROM notes
     WHERE user_id = ? ${AFTER_CURSOR} ${PAGE_ORDER}`,
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
    `SELECT ${LIST_COLUMNS} FROM notes
     WHERE user_id = ?
       AND (LOWER(title) LIKE LOWER(?) OR LOWER(content) LIKE LOWER(?))
     ${PAGE_ORDER}`,
  );
  const searchAfterStmt = db.prepare(
    `SELECT ${LIST_COLUMNS} FROM notes
     WHERE user_id = ?
       AND (LOWER(title) LIKE LOWER(?) OR LOWER(content) LIKE LOWER(?))
     ${AFTER_CURSOR} ${PAGE_ORDER}`,
  );

  const repo: NotesRepo = {
    async listByUser(
      userId: string,
      { limit, cursor }: ListNotesOptions,
    ): Promise<NotePage> {
      // One more than asked for, so the presence of a next page is a fact
      // about the rows rather than a second COUNT query.
      const after = cursor ? decodeCursor(cursor) : null;
      const rows = (
        after
          ? listAfterStmt.all(
              userId,
              after.updatedAt,
              after.updatedAt,
              after.id,
              limit + 1,
            )
          : listStmt.all(userId, limit + 1)
      ) as NoteRow[];
      return takePage(rows, limit);
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
      // Compare-and-set on `updated_at` when the caller passed `If-Match`;
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

    async search(
      userId: string,
      query: string,
      { limit, cursor }: ListNotesOptions,
    ): Promise<NotePage> {
      const like = searchPattern(query);
      if (like === null) return { notes: [], nextCursor: null };
      const after = cursor ? decodeCursor(cursor) : null;
      const rows = (
        after
          ? searchAfterStmt.all(
              userId,
              like,
              like,
              after.updatedAt,
              after.updatedAt,
              after.id,
              limit + 1,
            )
          : searchStmt.all(userId, like, like, limit + 1)
      ) as NoteRow[];
      return takePage(rows, limit);
    },
  };

  return repo;
}
