import {
  COMMENT_COLUMNS,
  type CommentRow,
  rowToComment,
} from "../commentMapping.js";
import type { CommentsRepo } from "../types.js";
import type { PgPool } from "./database.js";

export function createPostgresCommentsRepo(pool: PgPool): CommentsRepo {
  return {
    async listByNote(noteId) {
      const result = await pool.query<CommentRow>(
        `SELECT ${COMMENT_COLUMNS} FROM note_comments WHERE note_id = $1
         ORDER BY created_at, id`,
        [noteId],
      );
      return result.rows.map(rowToComment);
    },
    async countByNote(noteId) {
      const result = await pool.query<{ n: string | number }>(
        `SELECT COUNT(*) AS n FROM note_comments WHERE note_id = $1`,
        [noteId],
      );
      return Number(result.rows[0]?.n ?? 0);
    },
    async get(id) {
      const result = await pool.query<CommentRow>(
        `SELECT ${COMMENT_COLUMNS} FROM note_comments WHERE id = $1`,
        [id],
      );
      const [row] = result.rows;
      return row ? rowToComment(row) : null;
    },
    async create(comment) {
      await pool.query(
        `INSERT INTO note_comments (${COMMENT_COLUMNS})
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          comment.id,
          comment.noteId,
          comment.authorId,
          comment.body,
          comment.createdAt,
          comment.editedAt,
        ],
      );
    },
    async setBody(id, body, editedAt) {
      const result = await pool.query(
        `UPDATE note_comments SET body = $1, edited_at = $2 WHERE id = $3`,
        [body, editedAt, id],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async delete(id) {
      const result = await pool.query(
        `DELETE FROM note_comments WHERE id = $1`,
        [id],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}
