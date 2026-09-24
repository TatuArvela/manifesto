import {
  isLocalImageRef,
  type LinkPreview,
  type Note,
  NoteColor,
  type NoteCreate,
  NoteFont,
  type NoteUpdate,
  type NoteVersion,
} from "@manifesto/shared";
import { ulid } from "ulid";
import { dataUrlToBlob } from "../utils/dataUrl.js";
import {
  clearLocalImages,
  getLocalImage,
  putLocalImage,
  sweepLocalImages,
} from "./localImages.js";
import { isQuotaError, reportQuotaRefusal } from "./quota.js";
import type { StorageAdapter } from "./StorageAdapter.js";
import { getVersions, saveVersion } from "./VersionStorage.js";

const STORAGE_KEY = "manifesto:notes";

/** An image no note refers to is kept this long, sparing a draft's. */
const LOCAL_IMAGE_GRACE_MS = 24 * 60 * 60 * 1000;

/** Any image still inline, moved to IndexedDB and replaced by its reference. */
async function storeInline(images: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const image of images) {
    out.push(
      image.startsWith("data:")
        ? await putLocalImage(dataUrlToBlob(image))
        : image,
    );
  }
  return out;
}

/**
 * The list as last read or written, with the exact string it was stored as.
 *
 * Every write goes through the whole list (read, change one note, write it
 * back), and images once lived inside it as data URLs, so parsing it again on each
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

  /**
   * Every note. Images a note still holds inline, from before they moved to
   * IndexedDB, are moved there first, once; then images no note refers to
   * any more are swept, after a day's grace.
   */
  async getAll(): Promise<Note[]> {
    const notes = loadNotes();
    if (notes.some((n) => n.images.some((i) => i.startsWith("data:")))) {
      // A note whose images cannot be moved (IndexedDB unavailable or full, a
      // URL that will not decode) keeps them inline, where they still show;
      // the move is tried again on the next load. Failing here would leave an
      // empty board for notes that loaded fine before.
      const moved: Note[] = [];
      for (const note of notes) {
        try {
          moved.push({ ...note, images: await storeInline(note.images) });
        } catch {
          moved.push(note);
        }
      }
      try {
        saveNotes(moved);
      } catch {
        // The inline copies are still on disk; nothing is lost.
      }
    }
    const current = loadNotes();
    void sweepLocalImages(
      new Set(current.flatMap((n) => n.images)),
      LOCAL_IMAGE_GRACE_MS,
    ).catch(() => {});
    return current;
  }

  async get(id: string): Promise<Note | null> {
    return loadNotes().find((n) => n.id === id) ?? null;
  }

  async create(input: NoteCreate): Promise<Note> {
    const images = await storeInline(input.images ?? []);
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
      images,
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
    // Stored before the list is read, so the read, change and write below
    // stay one synchronous step no other write can come between.
    if (changes.images) {
      changes = { ...changes, images: await storeInline(changes.images) };
    }
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
    await clearLocalImages().catch(() => {});
  }

  async importAll(imported: Note[]): Promise<void> {
    const stored: Note[] = [];
    for (const note of imported) {
      stored.push({ ...note, images: await storeInline(note.images) });
    }
    imported = stored;
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

  async listVersions(noteId: string): Promise<NoteVersion[]> {
    return getVersions(noteId);
  }

  async saveVersion(
    noteId: string,
    version: { title: string; content: string },
  ): Promise<void> {
    saveVersion(noteId, version.title, version.content);
  }

  /** Kept in IndexedDB; the note holds its `local:` reference. */
  async putImage(image: Blob): Promise<string> {
    return putLocalImage(image);
  }

  async loadImage(ref: string): Promise<Blob> {
    if (!isLocalImageRef(ref)) {
      throw new Error("Open mode keeps its images in this browser");
    }
    return getLocalImage(ref);
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
