import type { ShareUser } from "#/note.ts";

/** The maximum length of a comment, in characters. */
export const MAX_COMMENT_LENGTH = 2000;
/**
 * The maximum number of comments on one note. The oldest comments do not go
 * away. The server refuses the next comment.
 */
export const MAX_COMMENTS_PER_NOTE = 500;

/**
 * A comment on a note. A person who can see the note writes it next to the
 * note. It is never part of the text of the note.
 */
export interface NoteComment {
  id: string;
  noteId: string;
  /**
   * Who wrote it, while they still have the note. Null when they do not: their
   * share was removed, they left, or their account is gone. The comment stays,
   * without their name.
   */
  author: ShareUser | null;
  /** Its text, sealed under the note key and bound to the id of the comment. */
  body: string;
  /** The note key under which it is. */
  keyVersion: number;
  createdAt: string;
  /** When its author last changed it. Null if it was never edited. */
  editedAt: string | null;
}

/** `GET /api/v1/notes/:id/comments`, oldest first. */
export interface NoteCommentsResponse {
  comments: NoteComment[];
}

/** One comment, as the answer to a create or an edit. */
export interface NoteCommentResponse {
  comment: NoteComment;
}

/**
 * `PUT /api/v1/notes/:id/comments/:commentId`: the sealed text, and its note
 * key.
 */
export interface NoteCommentRequest {
  body: string;
  keyVersion: number;
}

/**
 * `POST /api/v1/notes/:id/comments`. The client selects the id. The sealed text
 * is bound to it.
 */
export interface NoteCommentCreateRequest extends NoteCommentRequest {
  id: string;
}
