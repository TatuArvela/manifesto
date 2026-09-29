import type {
  Note,
  NoteCreate,
  NoteUpdate,
  NoteVersion,
  ShareRole,
} from "@manifesto/shared";

// Notes and what hangs off them: collaborative state, attachments, versions.

export interface InsertNoteInput {
  id: string;
  userId: string;
  data: NoteCreate;
  createdAt: string;
  updatedAt: string;
}

/** One page of a listing, plus the cursor that reaches the next one. */
export interface NotePage {
  /**
   * Attachments are stripped: each note carries `imageCount` and an empty
   * `images`. A listing exists to say what notes there are, and sending every
   * attachment of every note is what made that answer unbounded.
   */
  notes: Note[];
  nextCursor: string | null;
}

export interface ListNotesOptions {
  limit: number;
  /** The `nextCursor` of the previous page. */
  cursor?: string;
}

/**
 * What a user may do with a note, and whose it is.
 *
 * A note shared with someone is theirs to read (and, as an editor, to write)
 * only while they have accepted it and its owner has not put it in the trash.
 * An invitation grants nothing.
 */
export interface NoteAccess {
  role: "owner" | ShareRole;
  ownerId: string;
}

/**
 * A write the caller's role does not allow: a recipient touching what only the
 * owner decides (the trash, auto-note markers), or a viewer touching the note
 * itself. Nothing was written.
 */
export class NoteAccessError extends Error {
  constructor(public readonly fields: string[]) {
    super(`Not allowed to change: ${fields.join(", ")}`);
    this.name = "NoteAccessError";
  }
}

/**
 * Notes as one user sees them: their own, and those shared with them that they
 * accepted. A shared note carries the recipient's own color, pin, archive,
 * position, tags and reminder in place of the owner's, and every note that has
 * members carries `sharing`.
 */
export interface NotesRepo {
  /** One page of the notes the user can see, newest first, without
   * attachments. */
  listByUser(userId: string, options: ListNotesOptions): Promise<NotePage>;
  /**
   * One page of the notes the user can see whose row or members changed after
   * `since` (an ISO timestamp), newest first, without attachments. A shared
   * note's personal fields need no column of their own: a recipient's write
   * stamps the note's `updated_at` like any other.
   */
  listChanged(
    userId: string,
    since: string,
    options: ListNotesOptions,
  ): Promise<NotePage>;
  /** The ids of every note the user can see, in no particular order. */
  visibleIds(userId: string): Promise<string[]>;
  /** A single note the user can see, attachments and all. */
  getById(id: string, userId: string): Promise<Note | null>;
  /** The user's role on a note they can see, or null. */
  access(id: string, userId: string): Promise<NoteAccess | null>;
  /** Whether any note, anyone's, has this id. */
  exists(id: string): Promise<boolean>;
  insert(input: InsertNoteInput): Promise<Note>;
  /**
   * Update a note, optionally constrained by the current `updated_at` for
   * optimistic concurrency. Returns null when the user cannot see the note
   * or (if `expectedUpdatedAt` is provided) its `updated_at` no longer
   * matches. Callers can disambiguate the cases with a follow-up `getById`.
   *
   * The owner's changes go to the note. A recipient's go to the note (the
   * shared fields, editors only) and to their share (the personal ones), and
   * stamp the note's `updated_at` either way, so everyone holds one
   * concurrency token. Throws `NoteAccessError` when the role does not allow
   * a field.
   */
  update(
    id: string,
    userId: string,
    changes: NoteUpdate,
    updatedAt: string,
    expectedUpdatedAt?: string,
  ): Promise<Note | null>;
  /** Owner only. The note's shares go with it. */
  delete(id: string, userId: string): Promise<boolean>;
  /** One page of matches among the notes the user can see, newest first,
   * without attachments. */
  search(
    userId: string,
    query: string,
    options: ListNotesOptions,
  ): Promise<NotePage>;
}

/**
 * Keyed by the note and its owner. The collaboration socket authorizes a
 * participant before either is called, and passes the owner's id whoever the
 * participant is.
 */
export interface YjsStore {
  load(noteId: string, ownerId: string): Promise<Buffer | null>;
  /**
   * Persist Y.Doc state for a note. Does NOT touch the note's `updated_at`
   * field: Yjs writes are independent of REST writes, and bumping
   * `updated_at` on every keystroke would invalidate concurrent
   * `If-Match` tokens held by REST clients.
   */
  store(
    noteId: string,
    ownerId: string,
    state: Buffer,
    stateVector: Buffer,
  ): Promise<void>;
}

/** An image held in the attachment store, without its bytes. */
export interface AttachmentMeta {
  id: string;
  /** The owner of the notes that refer to it. */
  ownerId: string;
  sha256: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface StoredAttachment extends AttachmentMeta {
  data: Buffer;
}

/**
 * Images kept outside the note row (`attachment:<id>` in `Note.images`).
 * Content-addressed per owner: storing bytes an owner already has returns the
 * attachment that holds them, so sending the same inline image twice, as a
 * conflict retry or a stale tab does, never stores it twice.
 */
export interface AttachmentsRepo {
  put(input: Omit<StoredAttachment, "size">): Promise<AttachmentMeta>;
  get(id: string): Promise<StoredAttachment | null>;
  meta(id: string): Promise<AttachmentMeta | null>;
  /**
   * Whether `userId` may read it: they own it, or a note of its owner that
   * they hold an accepted share of, and the owner has not trashed, refers to
   * it.
   */
  readableBy(id: string, userId: string): Promise<boolean>;
  /**
   * Marks attachments no note refers to with `now`, clears the mark on those
   * referred to again, and deletes those marked before `cutoffIso`. Returns
   * how many it deleted.
   */
  sweep(now: string, cutoffIso: string): Promise<number>;
}

/**
 * A note's earlier title and content (connected mode's version history). The
 * repo keeps each note to `MAX_NOTE_VERSIONS` and `NOTE_VERSION_MAX_AGE_DAYS`
 * as versions are added; a deleted note takes its versions with it.
 */
export interface VersionsRepo {
  /** Newest first. */
  list(noteId: string): Promise<NoteVersion[]>;
  add(input: {
    id: string;
    noteId: string;
    authorId: string;
    title: string;
    content: string;
    createdAt: string;
  }): Promise<void>;
}
