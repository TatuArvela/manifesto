import type { OfferedKey } from "#/crypto/shareSeal.ts";
import type { ShareRole, ShareUser, TeamRef } from "#/note.ts";
import type { AccountPublicKeys } from "./keys.ts";

/** `GET /api/v1/users?q=`: accounts with which to share a note. */
export interface UserLookupResponse {
  users: DirectoryUser[];
}

export interface DirectoryUser extends ShareUser {
  /** Shown only where the server searches its accounts (`search`). */
  email?: string;
}

/**
 * `POST /api/v1/notes/:id/shares`. `key` is the note key wrapped to the public
 * key of the recipient and signed, when the client of the owner could make one.
 * Without it, the invitation waits for a key.
 */
export interface ShareCreateRequest {
  userId: string;
  role: ShareRole;
  key?: OfferedKey;
}

/**
 * `GET /api/v1/users/:id/keys`: the public keys of an account. Note keys are
 * wrapped to them, and its signatures are checked against them.
 */
export interface AccountPublicKeysResponse {
  userId: string;
  /** The account key to which they belong. */
  version: number;
  publicKeys: AccountPublicKeys;
}

/**
 * `GET /api/v1/auth/keys/seen`: the public keys that this account saw of the
 * people with whom it shares, by their account id. Each is sealed under the own
 * personal key of the account. A device keeps nothing after its session. Thus,
 * with this list, it can tell a key that it knows from a key that was replaced
 * after that.
 */
export interface SeenKeysResponse {
  seen: Record<string, string>;
}

/**
 * `PUT /api/v1/auth/keys/seen/:userId`: one of them, as it is remembered now.
 */
export interface SeenKeyRequest {
  sealed: string;
}

/** The maximum number of accounts whose keys one account remembers. */
export const MAX_SEEN_KEYS = 5000;

/**
 * `POST /api/v1/invitations/:noteId/accept`, and `PUT
 * /api/v1/notes/:id/held-key` after the key of the note was replaced: the note
 * key wrapped under the own notes key of the caller, as they keep the key of
 * their own note.
 */
export interface HeldKeyRequest {
  key: string;
  keyVersion: number;
}

/** `PUT /api/v1/notes/:id/shares/:userId`. */
export interface ShareUpdateRequest {
  role: ShareRole;
}

/** A note that a person offered to share with the signed-in user. */
export interface ShareInvitation {
  noteId: string;
  role: ShareRole;
  owner: ShareUser;
  /**
   * The title, text and font of the note, sealed under the note key. Thus, the
   * invitation can show the note itself, for the decision. Its attachments and
   * link previews wait until the note is accepted.
   */
  title: string;
  content: string;
  font: string;
  /** The note key under which they are. */
  keyVersion: number;
  /**
   * That key, wrapped to the public key of the recipient and signed by the
   * person who wrapped it. Null while nobody did: the invitation then waits for
   * a key, and shows nothing.
   */
  offered: OfferedKey | null;
  invitedAt: string;
  /** The team with which the note was shared, when it came that way. */
  team?: TeamRef;
}

export interface InvitationsResponse {
  invitations: ShareInvitation[];
}
