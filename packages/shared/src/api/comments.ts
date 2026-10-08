import type { ShareUser } from "../note.js";

/** The longest a comment may be, in characters. */
export const MAX_COMMENT_LENGTH = 2000;
/** How many comments one note holds; the oldest are not pushed out, the next
 * is refused. */
export const MAX_COMMENTS_PER_NOTE = 500;

/**
 * A comment on a note: written beside it by someone who can see it, and
 * never part of its text.
 */
export interface NoteComment {
  id: string;
  noteId: string;
  /**
   * Who wrote it, while they still have the note. Null once they do not:
   * their share was removed, they left, or their account is gone. The
   * comment stays, without their name.
   */
  author: ShareUser | null;
  body: string;
  createdAt: string;
  /** When its author last changed it; null for one never edited. */
  editedAt: string | null;
}

/** `GET /api/notes/:id/comments`, oldest first. */
export interface NoteCommentsResponse {
  comments: NoteComment[];
}

/** One comment, as creating or editing it answers. */
export interface NoteCommentResponse {
  comment: NoteComment;
}

/** `POST /api/notes/:id/comments` and `PUT .../comments/:commentId`. */
export interface NoteCommentRequest {
  body: string;
}
