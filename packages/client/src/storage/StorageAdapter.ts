import type { Note, NoteCreate, NoteUpdate } from "@manifesto/shared";

export interface StorageAdapter {
  getAll(): Promise<Note[]>;
  get(id: string): Promise<Note | null>;
  create(note: NoteCreate): Promise<Note>;
  update(id: string, changes: NoteUpdate): Promise<Note>;
  delete(id: string): Promise<void>;
  deleteAll(): Promise<void>;
  search(query: string): Promise<Note[]>;
  importAll(notes: Note[]): Promise<void>;
}
