import type {
  LinkPreview,
  Note,
  NoteCreate,
  NoteUpdate,
  NoteVersion,
} from "@manifesto/shared";

export interface UpdateOptions {
  /** Last-known updatedAt, sent as `If-Match` for optimistic concurrency. */
  ifMatch?: string;
}

export interface StorageAdapter {
  getAll(): Promise<Note[]>;
  get(id: string): Promise<Note | null>;
  create(note: NoteCreate): Promise<Note>;
  update(
    id: string,
    changes: NoteUpdate,
    options?: UpdateOptions,
  ): Promise<Note>;
  delete(id: string): Promise<void>;
  deleteAll(): Promise<void>;
  importAll(notes: Note[]): Promise<void>;
  /**
   * The attachments of one note. Server listings leave them out (they are the
   * bulk of a note and most of them are never looked at), so anything that
   * needs the bytes asks for them. In open mode nothing was ever separated, so
   * this is a read of what is already there.
   */
  loadImages(id: string): Promise<string[]>;
  /**
   * The bytes an image reference names: an `attachment:<id>` on the server
   * in connected mode, a `local:<hash>` in this browser's IndexedDB in open
   * mode. Rejects for the other kind, or bytes that are gone.
   */
  loadImage(ref: string): Promise<Blob>;
  /**
   * Stores an image and resolves the reference to put in a note's `images`:
   * uploaded in connected mode (`POST /api/attachments`, reporting progress
   * as a fraction) for an `attachment:` reference, kept in IndexedDB in open
   * mode for a `local:` one. Rejects if it could not be stored.
   */
  putImage(
    image: Blob,
    options?: { onProgress?: (fraction: number) => void; signal?: AbortSignal },
  ): Promise<string>;
  /**
   * A note's version history, newest first. Open mode keeps it in this
   * browser; connected mode on the server, so every device shares it.
   */
  listVersions(noteId: string): Promise<NoteVersion[]>;
  /** Adds a version; `timestamp` only when bringing an older one across. */
  saveVersion(
    noteId: string,
    version: { title: string; content: string; timestamp?: string },
  ): Promise<void>;
  /**
   * What the server could read from a linked page, with its image and favicon
   * as fetched (not yet shrunk). Null when there is nothing to add to the plain
   * link card: always in open mode, which has no server to ask and whose CSP
   * forbids asking anyone else, and in connected mode when the page could not
   * be fetched or the server has previews turned off.
   */
  fetchLinkPreview(url: string): Promise<LinkPreview | null>;
}
