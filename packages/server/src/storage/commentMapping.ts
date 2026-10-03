import type { StoredComment } from "./types.js";

export const COMMENT_COLUMNS =
  "id, note_id, author_id, body, created_at, edited_at";

export interface CommentRow {
  id: string;
  note_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
}

export function rowToComment(row: CommentRow): StoredComment {
  return {
    id: row.id,
    noteId: row.note_id,
    authorId: row.author_id,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}
