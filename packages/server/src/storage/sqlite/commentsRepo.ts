import {
  COMMENT_COLUMNS,
  type CommentRow,
  rowToComment,
} from "../commentMapping.js";
import type { CommentsRepo } from "../types.js";
import type { SqliteDB } from "./database.js";

export function createSqliteCommentsRepo(db: SqliteDB): CommentsRepo {
  const byNoteStmt = db.prepare(
    `SELECT ${COMMENT_COLUMNS} FROM note_comments WHERE note_id = ?
     ORDER BY created_at, id`,
  );
  const countStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM note_comments WHERE note_id = ?`,
  );
  const getStmt = db.prepare(
    `SELECT ${COMMENT_COLUMNS} FROM note_comments WHERE id = ?`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO note_comments (${COMMENT_COLUMNS})
     VALUES (@id, @noteId, @authorId, @body, @createdAt, @editedAt)`,
  );
  const bodyStmt = db.prepare(
    `UPDATE note_comments SET body = ?, edited_at = ? WHERE id = ?`,
  );
  const deleteStmt = db.prepare(`DELETE FROM note_comments WHERE id = ?`);
  return {
    async listByNote(noteId) {
      return (byNoteStmt.all(noteId) as CommentRow[]).map(rowToComment);
    },
    async countByNote(noteId) {
      return (countStmt.get(noteId) as { n: number }).n;
    },
    async get(id) {
      const row = getStmt.get(id) as CommentRow | undefined;
      return row ? rowToComment(row) : null;
    },
    async create(comment) {
      insertStmt.run(comment);
    },
    async setBody(id, body, editedAt) {
      return bodyStmt.run(body, editedAt, id).changes > 0;
    },
    async delete(id) {
      return deleteStmt.run(id).changes > 0;
    },
  };
}
