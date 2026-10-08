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
    async get(id) {
      const result = await pool.query<CommentRow>(
        `SELECT ${COMMENT_COLUMNS} FROM note_comments WHERE id = $1`,
        [id],
      );
      const [row] = result.rows;
      return row ? rowToComment(row) : null;
    },
    async create(comment, limit) {
      // The note's row is the lock: a second comment for the same note waits
      // here, and counts only once the first is in.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT id FROM notes WHERE id = $1 FOR UPDATE`, [
          comment.noteId,
        ]);
        const held = await client.query<{ n: string | number }>(
          `SELECT COUNT(*) AS n FROM note_comments WHERE note_id = $1`,
          [comment.noteId],
        );
        const room = Number(held.rows[0]?.n ?? 0) < limit;
        if (room) {
          await client.query(
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
        }
        await client.query("COMMIT");
        return room;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
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
