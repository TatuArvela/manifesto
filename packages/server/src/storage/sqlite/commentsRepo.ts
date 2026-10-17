import {
  COMMENT_COLUMNS,
  type CommentRow,
  rowToComment,
} from "#/storage/commentMapping.ts";
import type { CommentsRepo } from "#/storage/types.ts";
import type { SqliteDB } from "./database.ts";

export function createSqliteCommentsRepo(db: SqliteDB): CommentsRepo {
  const byNoteStmt = db.prepare(
    `SELECT ${COMMENT_COLUMNS} FROM note_comments WHERE note_id = ?
     ORDER BY created_at, id`,
  );
  const getStmt = db.prepare(
    `SELECT ${COMMENT_COLUMNS} FROM note_comments WHERE id = ?`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO note_comments (${COMMENT_COLUMNS})
     SELECT @id, @noteId, @authorId, @body, @keyVersion, @createdAt, @editedAt
     WHERE (SELECT COUNT(*) FROM note_comments WHERE note_id = @noteId) < @limit`,
  );
  const bodyStmt = db.prepare(
    `UPDATE note_comments SET body = ?, key_version = ?, edited_at = ?
     WHERE id = ?`,
  );
  const deleteStmt = db.prepare(`DELETE FROM note_comments WHERE id = ?`);
  return {
    async listByNote(noteId) {
      return (byNoteStmt.all(noteId) as CommentRow[]).map(rowToComment);
    },
    async get(id) {
      const row = getStmt.get(id) as CommentRow | undefined;
      return row ? rowToComment(row) : null;
    },
    async create(comment, limit) {
      return insertStmt.run({ ...comment, limit }).changes > 0;
    },
    async setBody(id, body, keyVersion, editedAt) {
      return bodyStmt.run(body, keyVersion, editedAt, id).changes > 0;
    },
    async delete(id) {
      return deleteStmt.run(id).changes > 0;
    },
  };
}
