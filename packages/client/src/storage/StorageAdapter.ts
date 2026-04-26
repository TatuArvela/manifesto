import type { Note, NoteCreate, NoteUpdate } from "@manifesto/shared";

export interface UpdateOptions {
  /** Last-known updatedAt — sent as `If-Match` for optimistic concurrency. */
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
}
