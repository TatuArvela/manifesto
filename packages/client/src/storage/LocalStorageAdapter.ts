import {
  type LinkPreview,
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

/**
 * The list as last read or written, with the exact string it was stored as.
 *
 * Every write goes through the whole list (read, change one note, write it
 * back), and images live inside it as data URLs, so parsing it again on each
 * auto-save put megabytes of `JSON.parse` on the main thread every half second
 * while the user typed. The key is still read every time, so a write from
 * another tab or a cleared store is noticed by the string no longer matching;
 * only the parse is skipped. The notes are shared, not copied: nothing changes
 * a note in place, every write replaces it.
 */
let cached: { raw: string; notes: Note[] } | null = null;

function loadNotes(): Note[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  if (cached && cached.raw === raw) return cached.notes.slice();
  try {
    const notes = (JSON.parse(raw) as Note[]).map((n) => ({
      ...n,
      font: n.font ?? NoteFont.Default,
      images: n.images ?? [],
      linkPreviews: n.linkPreviews ?? [],
      reminder: n.reminder ?? null,
    }));
    cached = { raw, notes };
    return notes.slice();
  } catch {
    return [];
  }
}

function saveNotes(notes: Note[]): void {
  try {
    const raw = JSON.stringify(notes);
    localStorage.setItem(STORAGE_KEY, raw);
    cached = { raw, notes: notes.slice() };
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
  /** Open mode keeps the plain link card: fetching a page would mean asking a
   * third party, which the build's CSP deliberately does not allow. */
  async fetchLinkPreview(_url: string): Promise<LinkPreview | null> {
    return null;
  }

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
