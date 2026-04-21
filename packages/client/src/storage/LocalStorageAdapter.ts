import {
  type Note,
  NoteColor,
  type NoteCreate,
  NoteFont,
  type NoteUpdate,
} from "@manifesto/shared";
import { ulid } from "ulid";
import type { StorageAdapter } from "./StorageAdapter.js";

const STORAGE_KEY = "manifesto:notes";

function loadNotes(): Note[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const notes = JSON.parse(raw) as Note[];
    return notes.map((n) => ({
      ...n,
      font: n.font ?? NoteFont.Default,
      images: n.images ?? [],
      linkPreviews: n.linkPreviews ?? [],
      reminder: n.reminder ?? null,
    }));
  } catch {
    return [];
  }
}

function saveNotes(notes: Note[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

export class LocalStorageAdapter implements StorageAdapter {
  async getAll(): Promise<Note[]> {
    return loadNotes();
  }

  async get(id: string): Promise<Note | null> {
    return loadNotes().find((n) => n.id === id) ?? null;
  }

  async create(input: NoteCreate): Promise<Note> {
    const notes = loadNotes();
    const now = new Date().toISOString();
    const note: Note = {
      id: ulid(),
      title: input.title ?? "",
      content: input.content ?? "",
      color: input.color ?? NoteColor.Default,
      font: input.font ?? NoteFont.Default,
      pinned: input.pinned ?? false,
      archived: input.archived ?? false,
      trashed: input.trashed ?? false,
      trashedAt: input.trashedAt ?? null,
      position: input.position ?? Date.now(),
      tags: input.tags ?? [],
      images: input.images ?? [],
      linkPreviews: input.linkPreviews ?? [],
      reminder: input.reminder ?? null,
      createdAt: now,
      updatedAt: now,
    };
    notes.push(note);
    saveNotes(notes);
    return note;
  }

  async update(id: string, changes: NoteUpdate): Promise<Note> {
    const notes = loadNotes();
    const index = notes.findIndex((n) => n.id === id);
    if (index === -1) throw new Error(`Note not found: ${id}`);
    const updated: Note = {
      ...notes[index],
      ...changes,
      updatedAt: new Date().toISOString(),
    };
    notes[index] = updated;
    saveNotes(notes);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const notes = loadNotes().filter((n) => n.id !== id);
    saveNotes(notes);
  }

  async deleteAll(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY);
  }

  async importAll(imported: Note[]): Promise<void> {
    const existing = loadNotes();
    const existingById = new Map(existing.map((n) => [n.id, n]));
    for (const note of imported) {
      existingById.set(note.id, note);
    }
    saveNotes([...existingById.values()]);
  }

  async search(query: string): Promise<Note[]> {
    const q = query.toLowerCase();
    return loadNotes().filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q),
    );
  }
}
