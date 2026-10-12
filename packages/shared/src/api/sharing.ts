import type { OfferedKey } from "../crypto/shareSeal.js";
import type { ShareRole, ShareUser, TeamRef } from "../note.js";
import type { AccountPublicKeys } from "./keys.js";

/** `GET /api/users?q=`: accounts to share a note with. */
export interface UserLookupResponse {
  users: DirectoryUser[];
}

export interface DirectoryUser extends ShareUser {
  /** Shown only where the server searches its accounts (`search`). */
  email?: string;
}

/**
 * `POST /api/notes/:id/shares`. `key` is the note key wrapped to the
 * recipient's public key and signed, when the owner's client could make one;
 * without it the invitation waits for a key.
 */
export interface ShareCreateRequest {
  userId: string;
  role: ShareRole;
  key?: OfferedKey;
}

/** `GET /api/users/:id/keys`: an account's public keys, to wrap a note key
 * to and to check its signatures against. */
export interface AccountPublicKeysResponse {
  userId: string;
  /** Which account key they belong to. */
  version: number;
  publicKeys: AccountPublicKeys;
}

/**
 * `POST /api/invitations/:noteId/accept`, and `PUT /api/notes/:id/held-key`
 * after the note's key was replaced: the note key wrapped under the caller's
 * own notes key, as they keep the key of a note of their own.
 */
export interface HeldKeyRequest {
  key: string;
  keyVersion: number;
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
   * The note's title, text and font, sealed under the note key, so the
   * invitation can show the note itself to decide on. Its attachments and
   * link previews wait until it is accepted.
   */
  title: string;
  content: string;
  font: string;
  /** Which note key they are under. */
  keyVersion: number;
  /**
   * That key, wrapped to the recipient's public key and signed by whoever
   * wrapped it. Null while nobody has: the invitation is then waiting for a
   * key, and shows nothing.
   */
  offered: OfferedKey | null;
  invitedAt: string;
  /** The team the note was shared with, when it came that way. */
  team?: TeamRef;
}

export interface InvitationsResponse {
  invitations: ShareInvitation[];
}
