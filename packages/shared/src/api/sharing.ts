import type {
  NoteColor,
  NoteFont,
  ShareRole,
  ShareUser,
  TeamRef,
} from "../note.js";

/** `GET /api/users?q=`: accounts to share a note with. */
export interface UserLookupResponse {
  users: DirectoryUser[];
}

export interface DirectoryUser extends ShareUser {
  /** Shown only where the server searches its accounts (`search`). */
  email?: string;
}

/** `POST /api/notes/:id/shares`. */
export interface ShareCreateRequest {
  userId: string;
  role: ShareRole;
}

/** `PUT /api/notes/:id/shares/:userId`. */
export interface ShareUpdateRequest {
  role: ShareRole;
}

/** A note someone has offered to share with the signed-in user. */
export interface ShareInvitation {
  noteId: string;
  role: ShareRole;
  owner: ShareUser;
  /**
   * The note's title, text, color and font, so the invitation can show the
   * note itself to decide on. Its attachments and link previews wait until it
   * is accepted.
   */
  title: string;
  content: string;
  color: NoteColor;
  font: NoteFont;
  invitedAt: string;
  /** The team the note was shared with, when it came that way. */
  team?: TeamRef;
}

export interface InvitationsResponse {
  invitations: ShareInvitation[];
}
