import type { LinkPreview, Note, NoteCreate, NoteVersion } from "../note.js";

// --- Pagination ---

/**
 * How many notes a list endpoint returns when the caller doesn't say. Large
 * enough that most accounts are one page, small enough that no single response
 * is unbounded.
 */
export const DEFAULT_NOTES_PAGE_SIZE = 200;

/** The most a caller may ask for in one page. */
export const MAX_NOTES_PAGE_SIZE = 500;

export interface PageParams {
  limit?: number;
  /** Opaque: the `nextCursor` of the previous page, and nothing else. */
  cursor?: string;
}

// --- REST responses ---

export interface NotesResponse<N = Note> {
  /**
   * One page of notes, newest first. Attachments are **not** included: a
   * listed note carries `imageCount` and an empty `images`, and the data URLs
   * arrive with `GET /api/notes/:id`. Sending every attachment of every note
   * on every load is what made a list response unbounded in the first place.
   */
  notes: N[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

/**
 * One page of `GET /api/sync`: the notes that changed since a checkpoint.
 * Page through it as through `/api/notes`; `checkpoint` and `ids` come on the
 * last page only, and the next sync sends that checkpoint back as `since`.
 */
export interface SyncResponse<N = Note> extends NotesResponse<N> {
  /**
   * Every note the user can see, changed or not. A note the client holds
   * whose id is missing here was deleted, or taken away from them, since.
   * Null on every page but the last.
   */
  ids: string[] | null;
  /** Opaque. Pass back as `since` next time; null on every page but the last. */
  checkpoint: string | null;
}

export interface NoteResponse<N = Note> {
  note: N;
}

/** Notes per `POST /api/notes/import` request; a larger backup is sent in
 * several. */
export const MAX_NOTES_PER_IMPORT = 100;

/**
 * One note of `POST /api/notes/import`: a note as created, with the `id` and
 * `createdAt` it had where it came from. An `id` this user owns is updated in
 * place, so importing the same backup twice changes nothing; an `id` taken by
 * a note this user cannot write gets a new one.
 */
export type NoteImport = NoteCreate & { id?: string; createdAt?: string };

/** `POST /api/notes/import`. */
export interface NotesImportRequest {
  notes: NoteImport[];
}

export interface NotesImportResponse {
  created: number;
  updated: number;
  /** Notes shared with this user, which are someone else's to change. */
  skipped: number;
  /**
   * Ids that belong to notes this user cannot see. A sealed note is bound to
   * its id, so the server cannot give one a new id as it does for a readable
   * note: the client seals it again under an id of its own and sends it once
   * more. Absent when there are none.
   */
  taken?: string[];
  /**
   * Ids of notes this user owns that were sent sealed under another key than
   * the note is under now, and so were not written: the client reads each
   * again and seals it under the key it has. Absent when there are none.
   */
  stale?: string[];
}

/** `POST /api/attachments`: the reference to put in a note's `images`. */
export interface AttachmentUploadResponse {
  ref: string;
}

/** The most references one `POST /api/attachments/claim` may carry: a
 * note's images, and a thumbnail and an icon for each of its previews. */
export const MAX_ATTACHMENTS_PER_CLAIM = 60;

/**
 * `POST /api/attachments/claim`: the images a note is about to name, to be
 * made its owner's. `noteId` is the note, or absent (or not there yet) for
 * one the caller is about to make.
 */
export interface AttachmentsClaimRequest {
  noteId?: string;
  refs: string[];
}

/** The owner's own reference for each, in the order they were sent. */
export interface AttachmentsClaimResponse {
  refs: string[];
}

/** `GET /api/notes/:id/versions`, newest first. */
export interface NoteVersionsResponse {
  versions: NoteVersion[];
}

/**
 * `POST /api/notes/:id/versions`. `timestamp` is for bringing a history kept
 * in a browser across with its own dates; the server stamps one left out.
 */
export interface NoteVersionCreateRequest {
  title: string;
  content: string;
  timestamp?: string;
}

// --- Link previews ---

export interface LinkPreviewResponse {
  /**
   * What the server could read from the page, or null when it could not be
   * fetched. `image` and `favicon` are the source images as fetched, inlined
   * as `data:` URLs up to `MAX_IMAGE_DATA_URL_BYTES`; they are not yet the
   * stored form: the client shrinks each to fit
   * `MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES` and uploads it as an attachment.
   */
  preview: LinkPreview | null;
}

// --- Search ---

export interface SearchParams {
  q: string;
}
