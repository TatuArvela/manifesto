import type {
  LinkPreview,
  Note,
  NoteCreate,
  NoteUpdate,
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
  search(query: string): Promise<Note[]>;
  importAll(notes: Note[]): Promise<void>;
  /**
   * The attachments of one note. Server listings leave them out (they are the
   * bulk of a note and most of them are never looked at), so anything that
   * needs the bytes asks for them. In open mode nothing was ever separated, so
   * this is a read of what is already there.
   */
  loadImages(id: string): Promise<string[]>;
  /**
   * What the server could read from a linked page, with its image and favicon
   * as fetched (not yet shrunk). Null when there is nothing to add to the plain
   * link card: always in open mode, which has no server to ask and whose CSP
   * forbids asking anyone else, and in connected mode when the page could not
   * be fetched or the server has previews turned off.
   */
  fetchLinkPreview(url: string): Promise<LinkPreview | null>;
}
