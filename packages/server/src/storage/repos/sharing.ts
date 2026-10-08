import type {
  PublicLink,
  PublicNote,
  ShareInvitation,
  ShareRole,
  ShareUser,
  TeamSource,
} from "@manifesto/shared";

// Sharing a note: with accounts, with teams, and by public link.

/** A note shared with one user: an invitation until `acceptedAt` is set. */
export interface NoteShare {
  noteId: string;
  userId: string;
  role: ShareRole;
  createdAt: string;
  acceptedAt: string | null;
  /** The team it came through; null for a share made to the user directly. */
  viaTeam: string | null;
}

/** Everyone with a stake in one note, for deciding who hears about it. */
export interface NoteAudience {
  ownerId: string;
  /** In the owner's trash, which hides it from everyone else. */
  trashed: boolean;
  /** Invitations and accepted shares both. */
  shares: NoteShare[];
}

export interface CreateShareInput {
  noteId: string;
  userId: string;
  role: ShareRole;
  createdAt: string;
  /** The team it comes through, if it does. */
  viaTeam?: string | null;
}

export interface SharesRepo {
  /** Null when there is no such note. */
  audience(noteId: string): Promise<NoteAudience | null>;
  /** Invite a user. `exists` when they already hold an invitation or a share,
   * and nothing was written. */
  create(input: CreateShareInput): Promise<"ok" | "exists">;
  setRole(noteId: string, userId: string, role: ShareRole): Promise<boolean>;
  /** Which team a share comes through, or null to make it a direct one. */
  setViaTeam(
    noteId: string,
    userId: string,
    teamId: string | null,
  ): Promise<boolean>;
  /**
   * Accept an invitation to a note that is not in its owner's trash. The
   * recipient starts with the note's color and at the end of their manual
   * order. False when there was no such invitation.
   */
  accept(noteId: string, userId: string, acceptedAt: string): Promise<boolean>;
  /** Remove an invitation or a share, returning what it was. */
  delete(noteId: string, userId: string): Promise<NoteShare | null>;
  /** The invitations waiting for a user, newest first, leaving out notes in
   * their owner's trash. */
  listInvitations(userId: string): Promise<ShareInvitation[]>;
  /** One invitation, as `listInvitations` describes it. */
  getInvitation(
    noteId: string,
    userId: string,
  ): Promise<ShareInvitation | null>;
  /** Every invitation and share a user holds on other people's notes. */
  listByRecipient(userId: string): Promise<NoteShare[]>;
  /** Every invitation and share on a user's own notes. */
  listByOwner(ownerId: string): Promise<NoteShare[]>;
}

export type { ShareUser };

/**
 * A public link as the server keeps it: what its owner sees, and what only
 * the server reads (the password hash, and a snapshot link's copy of the note).
 */
export interface StoredPublicLink extends PublicLink {
  ownerId: string;
  passwordHash: string | null;
  /** The note as it stood when a `snapshot` link was made; null for `live`. */
  snapshot: PublicNote | null;
}

export interface PublicLinksRepo {
  create(link: StoredPublicLink): Promise<void>;
  /** A note's links, newest first. */
  listByNote(noteId: string): Promise<StoredPublicLink[]>;
  get(token: string): Promise<StoredPublicLink | null>;
  /** Revoke: the link stops working at once. False if the note has no such
   * link. */
  delete(token: string, noteId: string): Promise<boolean>;
  /**
   * Count one view, as one statement, if the link can still be viewed at `at`
   * (not expired, not used up). False when it cannot, so two viewers racing
   * for a link's last view cannot both have it.
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
 * Teams, their members, and the notes shared with them. Only the rows: what a
 * team share means for each member's own share is `sharing/teamShares.ts`.
 */
export interface TeamsRepo {
  /** `exists` when the source already has a team by that name. */
  create(team: Omit<StoredTeam, "memberCount">): Promise<"ok" | "exists">;
  get(id: string): Promise<StoredTeam | null>;
  findByName(source: TeamSource, name: string): Promise<StoredTeam | null>;
  /** Every team, by name. */
  list(): Promise<StoredTeam[]>;
  /** The teams a user is in, by name. */
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
  /** The teams a note is shared with, oldest first. */
  sharesOfNote(noteId: string): Promise<NoteTeamShare[]>;
  /** The notes shared with a team. */
  notesOf(teamId: string): Promise<NoteTeamShare[]>;
}

/** A comment as stored: who wrote it, not whether they still have the note. */
export interface StoredComment {
  id: string;
  noteId: string;
  /** Null once the author's account is gone. */
  authorId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

/**
 * Comments beside a note. They go with the note (deleted by cascade) and
 * outlive their author's share and account; who may read or write one is the
 * routes' business, from the note's access.
 */
export interface CommentsRepo {
  /** Oldest first. */
  listByNote(noteId: string): Promise<StoredComment[]>;
  get(id: string): Promise<StoredComment | null>;
  /**
   * Adds a comment unless its note already holds `limit` of them: false then,
   * with nothing written. Counting and writing are one step, so comments
   * arriving together cannot each find room for themselves.
   */
  create(comment: StoredComment, limit: number): Promise<boolean>;
  /** False when there is no such comment. */
  setBody(id: string, body: string, editedAt: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}
