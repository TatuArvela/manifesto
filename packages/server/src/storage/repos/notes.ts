import type {
  NoteRekeyRequest,
  SealedNote,
  SealedNoteCreate,
  SealedNoteUpdate,
  SealedNoteVersion,
  ShareRole,
} from "@manifesto/shared";

// Notes and what belongs to them: collaborative state, attachments, versions.

declare const claimed: unique symbol;

/**
 * The image references of a note after `claimImages` (in
 * `attachments/store.ts`) gave each one to the owner of the note. Only that
 * function makes one. Thus, a write that skipped it does not typecheck. A
 * reference directly from a request could name the attachment of a different
 * person, and the note would give it to all persons who can read the note.
 */
export type ClaimedImages = string[] & { readonly [claimed]: "images" };

/**
 * A new note as storage accepts it: the attachments that it names are claimed.
 */
export type StoredNoteCreate = Omit<
  SealedNoteCreate,
  "id" | "imageRefs" | "previewRefs"
> & {
  imageRefs: ClaimedImages;
  previewRefs: ClaimedImages;
};

/**
 * A change to a note as storage accepts it: the attachments that it names are
 * claimed.
 */
export type StoredNoteUpdate = Omit<
  SealedNoteUpdate,
  "imageRefs" | "previewRefs"
> & {
  imageRefs?: ClaimedImages;
  previewRefs?: ClaimedImages;
};

export interface InsertNoteInput {
  id: string;
  userId: string;
  data: StoredNoteCreate;
  createdAt: string;
  updatedAt: string;
}

/** One page of a listing, and the cursor to the next page. */
export interface NotePage {
  notes: SealedNote[];
  nextCursor: string | null;
}

export interface ListNotesOptions {
  limit: number;
  /** The `nextCursor` of the previous page. */
  cursor?: string | undefined;
}

/**
 * What a user can do with a note, and its owner.
 *
 * A person can read a note shared with them (and, as an editor, write it) only
 * while they have accepted it, and while its owner did not put it in the trash.
 * An invitation gives no rights.
 */
export interface NoteAccess {
  role: "owner" | ShareRole;
  ownerId: string;
}

/**
 * A write that the role of the caller does not permit: a recipient that changes
 * what only the owner decides (the trash, auto-note markers), or a viewer that
 * changes the note itself. Nothing was written.
 */
export class NoteAccessError extends Error {
  constructor(public readonly fields: string[]) {
    super(`Not allowed to change: ${fields.join(", ")}`);
    this.name = "NoteAccessError";
  }
}

/**
 * Notes as one user sees them: their own notes, and the notes shared with them
 * that they accepted. A shared note contains the own color, pin, archive,
 * position, tags and reminder of the recipient in place of those of the owner.
 * Each note that has members contains `sharing`.
 */
/** The shared fields of a note under a new key. See `NotesRepo.rekey`. */
export type RekeyedNote = Omit<NoteRekeyRequest, "links">;

/** The copy of the new key of a live public link, wrapped by its link key. */
export type RewrappedLink = NonNullable<NoteRekeyRequest["links"]>[number];

export interface NotesRepo {
  /** One page of the notes that the user can see, newest first. */
  listByUser(userId: string, options: ListNotesOptions): Promise<NotePage>;
  /**
   * One page of the notes that the user can see whose row or members changed
   * after `since` (an ISO timestamp), newest first. The personal fields of a
   * shared note need no column of their own. A write by a recipient sets the
   * `updated_at` of the note, as all writes do.
   */
  listChanged(
    userId: string,
    since: string,
    options: ListNotesOptions,
  ): Promise<NotePage>;
  /** The ids of all notes that the user can see, in no specified order. */
  visibleIds(userId: string): Promise<string[]>;
  /** One note that the user can see. */
  getById(id: string, userId: string): Promise<SealedNote | null>;
  /** The role of the user on a note that they can see, or null. */
  access(id: string, userId: string): Promise<NoteAccess | null>;
  /** If any note, of any person, has this id. */
  exists(id: string): Promise<boolean>;
  /**
   * The ids of the attachments that a note names, in its images and its link
   * previews: the own record of the server, which no reader gets.
   */
  attachmentIds(id: string): Promise<string[]>;
  insert(input: InsertNoteInput): Promise<SealedNote>;
  /**
   * Update a note. An optional condition on the current `updated_at` gives
   * optimistic concurrency. Returns null when the user cannot see the note, or
   * (if `expectedUpdatedAt` is given) when its `updated_at` does not match now.
   * Callers can tell the cases apart with a `getById` after it.
   *
   * The changes of the owner go to the note. The changes of a recipient go to
   * the note (the shared fields, only for editors) and to their share (the
   * personal fields). Both set the `updated_at` of the note. Thus, all persons
   * have one concurrency token. Throws `NoteAccessError` when the role does not
   * permit a field.
   *
   * `expectedKeyVersion` checks the write against the key under which its words
   * were sealed, in the same statement. It also returns null when the note left
   * that key. Thus, a write that raced a replacement stores nothing that nobody
   * can open.
   */
  update(
    id: string,
    userId: string,
    changes: StoredNoteUpdate,
    updatedAt: string,
    expectedUpdatedAt?: string,
    expectedKeyVersion?: number,
  ): Promise<SealedNote | null>;
  /**
   * Puts the note of the owner under a new key: its sealed fields, the wrapped
   * copy of the owner and the previous keys, all at the same time. It does this
   * only while the note is still under `fromVersion` and as it was at
   * `expectedUpdatedAt`, because the fields were sealed again from a read, and
   * a later write is not in them. Each live link in `links` gets its copy of
   * the new key in the same write. Thus, the note never moves without them. The
   * code skips a named link that is gone or not live. After that, the copies of
   * the key of all other persons are behind, and they wait for the new key.
   * False when the note does not belong to this owner, its key moved on, or it
   * changed after that read.
   */
  rekey(
    id: string,
    ownerId: string,
    rekeyed: RekeyedNote,
    fromVersion: number,
    updatedAt: string,
    expectedUpdatedAt: string,
    links: readonly RewrappedLink[],
  ): Promise<boolean>;
  /** Only the owner. The shares of the note go with it. */
  delete(id: string, userId: string): Promise<boolean>;
}

/**
 * The key is the note and its owner. The collaboration socket authorizes a
 * participant before either is called, and gives the id of the owner, whoever
 * the participant is.
 */
export interface YjsStore {
  load(noteId: string, ownerId: string): Promise<Buffer | null>;
  /**
   * Store the Y.Doc state of a note. Does NOT change the `updated_at` field of
   * the note. Yjs writes are independent of REST writes. A change of
   * `updated_at` on each keystroke would make the `If-Match` tokens of REST
   * clients invalid.
   */
  store(
    noteId: string,
    ownerId: string,
    state: Buffer,
    stateVector: Buffer,
  ): Promise<void>;
}

/** An image in the attachment store, without its bytes. */
export interface AttachmentMeta {
  id: string;
  /** The owner of the notes that refer to it. */
  ownerId: string;
  sha256: string;
  contentType: string;
  size: number;
  createdAt: string;
  /**
   * For an image that a token uploaded: its key, wrapped under the notes key of
   * the uploader, until a note names the image. Null for an image that the app
   * sealed.
   */
  wrappedKey: string | null;
}

export interface StoredAttachment extends AttachmentMeta {
  data: Buffer;
}

/**
 * Images kept outside the note row (`attachment:<id>` in `Note.images`).
 * Content-addressed for each owner: when the code stores bytes that an owner
 * already has, it returns the attachment that contains them. Thus, the same
 * inline image sent two times, as a conflict retry or a stale tab does, is
 * never stored two times.
 */
export interface AttachmentsRepo {
  put(
    input: Omit<StoredAttachment, "size" | "wrappedKey"> & {
      wrappedKey?: string | null;
    },
  ): Promise<AttachmentMeta>;
  get(id: string): Promise<StoredAttachment | null>;
  meta(id: string): Promise<AttachmentMeta | null>;
  /**
   * If `userId` can read it: they own it, or a note of its owner refers to it,
   * of which they have an accepted share and which the owner did not put in the
   * trash.
   */
  readableBy(id: string, userId: string): Promise<boolean>;
  /**
   * Marks attachments to which no note refers with `now`, clears the mark on
   * attachments to which a note refers again, and deletes attachments marked
   * before `cutoffIso`. Returns the number that it deleted.
   */
  sweep(now: string, cutoffIso: string): Promise<number>;
}

/**
 * The earlier title and content of a note (the version history of connected
 * mode), sealed as the note. The repo keeps each note to `MAX_NOTE_VERSIONS`
 * and `NOTE_VERSION_MAX_AGE_DAYS` when it adds versions. A deleted note takes
 * its versions with it.
 */
export interface VersionsRepo {
  /** Newest first. */
  list(noteId: string): Promise<SealedNoteVersion[]>;
  /** False when a version already has this id. This changes nothing. */
  add(input: {
    id: string;
    noteId: string;
    authorId: string;
    keyVersion: number;
    format: number;
    title: string;
    content: string;
    createdAt: string;
  }): Promise<boolean>;
}
