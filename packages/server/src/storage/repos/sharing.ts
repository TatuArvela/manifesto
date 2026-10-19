import type {
  OfferedKey,
  PublicLink,
  PublicSnapshot,
  ShareInvitation,
  ShareRole,
  ShareUser,
  TeamSource,
} from "@manifesto/shared";

// How to share a note: with accounts, with teams, and by public link.

/** A note shared with one user: an invitation until `acceptedAt` is set. */
export interface NoteShare {
  noteId: string;
  userId: string;
  role: ShareRole;
  createdAt: string;
  acceptedAt: string | null;
  /** The team through which it came. Null for a direct share to the user. */
  viaTeam: string | null;
}

/** All persons that a note concerns, to decide who gets its events. */
export interface NoteAudience {
  ownerId: string;
  /** In the trash of the owner, which hides it from all other persons. */
  trashed: boolean;
  /** Invitations and accepted shares. */
  shares: NoteShare[];
}

export interface CreateShareInput {
  noteId: string;
  userId: string;
  role: ShareRole;
  createdAt: string;
  /** The team through which it comes, if it does. */
  viaTeam?: string | null;
  /** The note key wrapped for them, when the inviter could make one. */
  offeredKey?: OfferedKey | null;
}

/** A note key as its holder keeps it, and which key it is. */
export interface HeldKey {
  key: string;
  keyVersion: number;
}

export interface SharesRepo {
  /** Null when there is no such note. */
  audience(noteId: string): Promise<NoteAudience | null>;
  /**
   * Invite a user. `exists` when they already have an invitation or a share.
   * Then nothing was written.
   */
  create(input: CreateShareInput): Promise<"ok" | "exists">;
  setRole(noteId: string, userId: string, role: ShareRole): Promise<boolean>;
  /**
   * The team through which a share comes, or null to make it a direct share.
   */
  setViaTeam(
    noteId: string,
    userId: string,
    teamId: string | null,
  ): Promise<boolean>;
  /**
   * Accept an invitation to a note that is not in the trash of its owner, and
   * keep the note key as the recipient wrapped it for themselves. The recipient
   * starts at the start of their manual order. False when there was no such
   * invitation.
   */
  accept(
    noteId: string,
    userId: string,
    acceptedAt: string,
    held: HeldKey,
  ): Promise<boolean>;
  /**
   * Give a person on the note its key, wrapped to their public key. It replaces
   * an earlier offer. False when they have no invitation or share.
   */
  offerKey(
    noteId: string,
    userId: string,
    offered: OfferedKey,
  ): Promise<boolean>;
  /**
   * The note key as an accepted recipient keeps it now, after the key of the
   * note was replaced. Its offer is complete. False when they have no accepted
   * share.
   */
  holdKey(noteId: string, userId: string, held: HeldKey): Promise<boolean>;
  /** Remove an invitation or a share, and return what it was. */
  delete(noteId: string, userId: string): Promise<NoteShare | null>;
  /**
   * The invitations that wait for a user, newest first, without the notes in
   * the trash of their owner.
   */
  listInvitations(userId: string): Promise<ShareInvitation[]>;
  /** One invitation, as `listInvitations` describes it. */
  getInvitation(
    noteId: string,
    userId: string,
  ): Promise<ShareInvitation | null>;
  /** All invitations and shares that a user has on notes of other people. */
  listByRecipient(userId: string): Promise<NoteShare[]>;
  /** All invitations and shares on the own notes of a user. */
  listByOwner(ownerId: string): Promise<NoteShare[]>;
  /**
   * All invitations and shares that came through a team, whether the team still
   * exists or not.
   */
  listByTeam(teamId: string): Promise<NoteShare[]>;
}

export type { ShareUser };

/**
 * A public link as the server keeps it: what its owner sees, and what only the
 * server reads (the password hash, and the copy of the note of a snapshot
 * link).
 */
export interface StoredPublicLink extends PublicLink {
  ownerId: string;
  passwordHash: string | null;
  /**
   * The note as it was when a `snapshot` link was made, sealed for the link.
   * Null for `live`.
   */
  snapshot: StoredSnapshot | null;
  /** The copy of the note key of a `live` link, wrapped by the link key. */
  wrappedKey: string | null;
}

/** A snapshot as kept: what the browser of the owner sealed, and when. */
export interface StoredSnapshot extends PublicSnapshot {
  updatedAt: string;
}

export interface PublicLinksRepo {
  create(link: StoredPublicLink): Promise<void>;
  /** The links of a note, newest first. */
  listByNote(noteId: string): Promise<StoredPublicLink[]>;
  get(token: string): Promise<StoredPublicLink | null>;
  /** Revoke: the link stops immediately. False if the note has no such link. */
  delete(token: string, noteId: string): Promise<boolean>;
  /**
   * Count one view, as one statement, if the link can still be viewed at `at`
   * (not expired, not at its limit). False when it cannot. Thus, two viewers
   * that race for the last view of a link cannot both get it.
   */
  recordView(token: string, at: string): Promise<boolean>;
}

export interface StoredTeam {
  id: string;
  name: string;
  source: TeamSource;
  createdAt: string;
  memberCount: number;
}

/** A note shared with a team. */
export interface NoteTeamShare {
  noteId: string;
  teamId: string;
  role: ShareRole;
  createdAt: string;
}

/**
 * Teams, their members, and the notes shared with them. Only the rows.
 * `sharing/teamShares.ts` tells what a team share means for the own share of
 * each member.
 */
export interface TeamsRepo {
  /** `exists` when the source already has a team with that name. */
  create(team: Omit<StoredTeam, "memberCount">): Promise<"ok" | "exists">;
  get(id: string): Promise<StoredTeam | null>;
  findByName(source: TeamSource, name: string): Promise<StoredTeam | null>;
  /** All teams, by name. */
  list(): Promise<StoredTeam[]>;
  /** The teams of a user, by name. */
  listForUser(userId: string): Promise<StoredTeam[]>;
  rename(id: string, name: string): Promise<"ok" | "exists" | "missing">;
  delete(id: string): Promise<boolean>;
  members(teamId: string): Promise<string[]>;
  /** False when they were already in it. */
  addMember(teamId: string, userId: string): Promise<boolean>;
  /** False when they were not in it. */
  removeMember(teamId: string, userId: string): Promise<boolean>;
  /** False when the note is already shared with the team. */
  shareNote(share: NoteTeamShare): Promise<boolean>;
  setNoteRole(
    noteId: string,
    teamId: string,
    role: ShareRole,
  ): Promise<boolean>;
  unshareNote(noteId: string, teamId: string): Promise<boolean>;
  /** The teams with which a note is shared, oldest first. */
  sharesOfNote(noteId: string): Promise<NoteTeamShare[]>;
  /** The notes shared with a team. */
  notesOf(teamId: string): Promise<NoteTeamShare[]>;
}

/** A comment as stored: who wrote it, not if they still have the note. */
export interface StoredComment {
  id: string;
  noteId: string;
  /** Null after the account of the author is gone. */
  authorId: string | null;
  /** Sealed under the note key of `keyVersion`. */
  body: string;
  keyVersion: number;
  createdAt: string;
  editedAt: string | null;
}

/**
 * Comments next to a note. They go with the note (deleted by cascade), and stay
 * after the share and the account of their author go. The routes decide who can
 * read or write one, from the access to the note.
 */
export interface CommentsRepo {
  /** Oldest first. */
  listByNote(noteId: string): Promise<StoredComment[]>;
  get(id: string): Promise<StoredComment | null>;
  /**
   * Adds a comment, unless its note already has `limit` of them. Then it
   * returns false, and writes nothing. The count and the write are one step.
   * Thus, comments that arrive together cannot each find space for themselves.
   */
  create(comment: StoredComment, limit: number): Promise<boolean>;
  /** False when there is no such comment. */
  setBody(
    id: string,
    body: string,
    keyVersion: number,
    editedAt: string,
  ): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}
