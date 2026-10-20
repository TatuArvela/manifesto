import type {
  LinkPreview,
  Note,
  NoteCreate,
  NoteUpdate,
  NoteVersion,
} from "@manifesto/shared";

export interface UpdateOptions {
  /**
   * The last known updatedAt, sent as `If-Match` for optimistic concurrency.
   */
  ifMatch?: string;
}

/** What changed since a checkpoint. See `StorageAdapter.changesSince`. */
export interface NoteChanges {
  /**
   * The notes that changed, without their attachments, as a listing has them.
   */
  notes: Note[];
  /** Each note that the user can see now, changed or not. */
  ids: string[];
  /** Where this stopped: the `since` of the next call. */
  checkpoint: string;
}

/** What a new note is stored with, other than its fields. */
export interface CreateOptions {
  id?: string | undefined;
}

export interface StorageAdapter {
  getAll(): Promise<Note[]>;
  /**
   * The notes that changed since `since` (null for all notes), or null when
   * this storage keeps no record of changes and the caller must list all. A
   * server does (`GET /api/v1/sync`). The own storage of a browser has no other
   * writer.
   */
  changesSince(since: string | null): Promise<NoteChanges | null>;
  get(id: string): Promise<Note | null>;
  /**
   * Stores a new note. The caller selects `id` when it must be known before the
   * write arrives. A note queued while offline is sent again under the same id.
   * Thus, a write that arrived, but whose answer was lost, is found and not
   * made two times.
   */
  create(note: NoteCreate, options?: CreateOptions): Promise<Note>;
  update(
    id: string,
    changes: NoteUpdate,
    options?: UpdateOptions,
  ): Promise<Note>;
  delete(id: string): Promise<void>;
  deleteAll(): Promise<void>;
  importAll(notes: Note[]): Promise<void>;
  /**
   * The attachments of one note. Server listings do not include them (they are
   * most of a note, and nobody looks at most of them). Thus, all code that
   * needs the bytes asks for them. In open mode, nothing was ever separated.
   * Thus, this is a read of what is already there.
   */
  loadImages(id: string): Promise<string[]>;
  /**
   * The bytes that an image reference names: an `attachment:<id>` on the server
   * in connected mode, a `local:<hash>` in the IndexedDB of this browser in
   * open mode. Rejects for the other kind, or for bytes that are gone.
   */
  loadImage(ref: string): Promise<Blob>;
  /**
   * Stores an image, and resolves the reference to put in the `images` of a
   * note. Uploaded in connected mode (`POST /api/v1/attachments`, with progress
   * reported as a fraction) for an `attachment:` reference. Kept in IndexedDB
   * in open mode for a `local:` reference. Rejects if the code could not store
   * it.
   */
  putImage(
    image: Blob,
    options?: { onProgress?: (fraction: number) => void; signal?: AbortSignal },
  ): Promise<string>;
  /**
   * The version history of a note, newest first. Open mode keeps it in this
   * browser. Connected mode keeps it on the server. Thus, all devices share it.
   */
  listVersions(noteId: string): Promise<NoteVersion[]>;
  /**
   * Adds a version. `timestamp` only when the code brings across an older
   * version.
   */
  saveVersion(
    noteId: string,
    version: { title: string; content: string; timestamp?: string },
  ): Promise<void>;
  /**
   * What the server could read from a linked page, with its image and favicon
   * as loaded (not shrunk yet). Null when there is nothing to add to the plain
   * link card. That is always so in open mode, which has no server to ask and
   * whose CSP forbids to ask any other party. In connected mode, it is so when
   * the page did not load, or when the server has previews turned off.
   */
  fetchLinkPreview(url: string): Promise<LinkPreview | null>;
}
