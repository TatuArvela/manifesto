import {
  type Note,
  NoteColor,
  type NoteCreate,
  NoteFont,
  type NoteUpdate,
} from "@manifesto/shared";
import { ulid } from "ulid";
import { isQuotaError, reportQuotaRefusal } from "./quota.js";
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch (err) {
    if (isQuotaError(err)) {
      // Say so and carry on: the in-memory signal still reflects the change,
      // so the session keeps working. What the user is told about it is
      // decided in `actions.ts`.
      reportQuotaRefusal();
      return;
    }
    throw err;
  }
}

/** Whether this browser has ever saved notes in open mode. */
export function hasStoredNotes(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Calls `onChange` when another tab writes the notes key, with the list as it
 * now stands on disk.
 *
 * Every tab holds the whole list in a signal and writes all of it back on any
 * edit, so without this the last tab to save wins: trash a note in one tab,
 * change anything at all in another, and the trashed note is back. The event
 * only fires in tabs other than the writer, so this cannot loop.
 */
export function subscribeToExternalNotes(
  onChange: (notes: Note[]) => void,
): () => void {
  const handler = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    // A null key means the whole store was cleared.
    onChange(loadNotes());
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
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

  /** Already here: open mode never separates a note from its attachments. */
  async loadImages(id: string): Promise<string[]> {
    return (await this.get(id))?.images ?? [];
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
