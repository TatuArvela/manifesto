import type { LinkPreview, Note, NoteCreate, NoteVersion } from "#/note.ts";

// --- Pagination ---

/**
 * The number of notes that a list endpoint returns when the caller does not
 * give a number. It is large, so that most accounts have one page. It is small,
 * so that no single response is unbounded.
 */
export const DEFAULT_NOTES_PAGE_SIZE = 200;

/** The maximum page size that a caller can ask for. */
export const MAX_NOTES_PAGE_SIZE = 500;

export interface PageParams {
  limit?: number;
  /** Opaque: only the `nextCursor` of the previous page. */
  cursor?: string;
}

// --- REST responses ---

export interface NotesResponse<N = Note> {
  /**
   * One page of notes, newest first. Attachments are **not** included. A listed
   * note contains `imageCount` and an empty `images`, and the data URLs come
   * with `GET /api/v1/notes/:id`. When each load sent all attachments of all
   * notes, a list response was unbounded.
   */
  notes: N[];
  /** Send back as `cursor` for the next page. Null on the last page. */
  nextCursor: string | null;
}

/**
 * One page of `GET /api/v1/sync`: the notes that changed since a checkpoint.
 * Page through it as through `/api/v1/notes`. `checkpoint` and `ids` come only
 * on the last page. The next sync sends that checkpoint back as `since`.
 */
export interface SyncResponse<N = Note> extends NotesResponse<N> {
  /**
   * All notes that the user can see, changed or not. If the id of a note that
   * the client has is missing here, the note was deleted, or taken away from
   * them, since then. Null on all pages other than the last.
   */
  ids: string[] | null;
  /**
   * Opaque. Send back as `since` the next time. Null on all pages other than
   * the last.
   */
  checkpoint: string | null;
}

export interface NoteResponse<N = Note> {
  note: N;
}

/**
 * The number of notes for each `POST /api/v1/notes/import` request. A larger
 * backup goes in many requests.
 */
export const MAX_NOTES_PER_IMPORT = 100;

/**
 * One note of `POST /api/v1/notes/import`: a note as created, with the `id` and
 * `createdAt` that it had in its source. The server updates an `id` that this
 * user owns in place. Thus, if you import the same backup two times, nothing
 * changes. An `id` that a note has that this user cannot write gets a new id.
 */
export type NoteImport = NoteCreate & { id?: string; createdAt?: string };

/** `POST /api/v1/notes/import`. */
export interface NotesImportRequest {
  notes: NoteImport[];
}

export interface NotesImportResponse {
  created: number;
  updated: number;
  /** Notes shared with this user. A different person owns and changes them. */
  skipped: number;
  /**
   * Ids of notes that this user cannot see. A sealed note is bound to its id.
   * Thus, the server cannot give it a new id, as it does for a readable note.
   * The client seals it again under its own new id, and sends it one more time.
   * Absent when there are none.
   */
  taken?: string[];
  /**
   * Ids of notes that this user owns that came sealed under a different key
   * than the current key of the note. The server did not write them. The client
   * reads each one again, and seals it under its key. Absent when there are
   * none.
   */
  stale?: string[];
}

/**
 * `POST /api/v1/attachments`: the reference to put in the `images` of a note.
 */
export interface AttachmentUploadResponse {
  ref: string;
}

/**
 * The maximum number of references in one `POST /api/v1/attachments/claim`: the
 * images of a note, and a thumbnail and an icon for each of its previews.
 */
export const MAX_ATTACHMENTS_PER_CLAIM = 60;

/**
 * `POST /api/v1/attachments/claim`: the images that a note will name, to give
 * to its owner. `noteId` is the note. It is absent (or the note does not exist
 * yet) for a note that the caller will make.
 */
export interface AttachmentsClaimRequest {
  noteId?: string;
  refs: string[];
}

/** The own reference of the owner for each one, in the order that they came. */
export interface AttachmentsClaimResponse {
  refs: string[];
}

/** `GET /api/v1/notes/:id/versions`, newest first. */
export interface NoteVersionsResponse {
  versions: NoteVersion[];
}

/**
 * `POST /api/v1/notes/:id/versions`. `timestamp` is for a history kept in a
 * browser, so that it keeps its own dates. If it is not given, the server sets
 * one.
 */
export interface NoteVersionCreateRequest {
  title: string;
  content: string;
  timestamp?: string;
}

// --- Link previews ---

export interface LinkPreviewResponse {
  /**
   * What the server could read from the page, or null when it could not get it.
   * `image` and `favicon` are the source images as the server got them, inlined
   * as `data:` URLs up to `MAX_IMAGE_DATA_URL_BYTES`. They are not the stored
   * form yet. The client makes each one fit
   * `MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES`, and uploads it as an attachment.
   */
  preview: LinkPreview | null;
}

// --- Search ---

export interface SearchParams {
  q: string;
}
