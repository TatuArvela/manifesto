import type { StoredComment } from "./types.js";

export const COMMENT_COLUMNS =
  "id, note_id, author_id, body, key_version, created_at, edited_at";

export interface CommentRow {
  id: string;
  note_id: string;
  author_id: string | null;
  body: string;
  key_version: number | string;
  created_at: string;
  edited_at: string | null;
}

export function rowToComment(row: CommentRow): StoredComment {
  return {
    id: row.id,
    noteId: row.note_id,
    authorId: row.author_id,
    body: row.body,
    keyVersion: Number(row.key_version),
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}
