import {
  isLocalImageRef,
  type LinkPreview,
  mapPreviewImages,
  type Note,
  NoteColor,
  type NoteCreate,
  NoteFont,
  type NoteUpdate,
  type NoteVersion,
  previewImages,
} from "@manifesto/shared";
import { ulid } from "ulid";
import { dataUrlToBlob } from "#/utils/dataUrl.ts";
import {
  clearLocalImages,
  getLocalImage,
  putLocalImage,
  sweepLocalImages,
} from "./localImages.ts";
import { openModeImageRefs } from "./offlineNotes.ts";
import { isQuotaError, reportQuotaRefusal } from "./quota.ts";
import type {
  CreateOptions,
  NoteChanges,
  StorageAdapter,
} from "./StorageAdapter.ts";
import { getVersions, saveVersion } from "./VersionStorage.ts";

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
 * The same for link preview images, which only an import brings here inline
 * (open mode never fetches a preview). One that cannot be stored stays
 * inline, where it still shows.
 */
async function storeInlinePreviews(
  previews: LinkPreview[],
): Promise<LinkPreview[]> {
  return await mapPreviewImages(previews, async (image) =>
    image.startsWith("data:")
      ? await putLocalImage(dataUrlToBlob(image)).catch(() => image)
      : image,
  );
}

/** Every image a note holds, its previews' included. */
function imagesOf(note: Note): string[] {
  return [...note.images, ...previewImages(note.linkPreviews)];
}

/** Whether a note still holds any image inline. */
function holdsInline(note: Note): boolean {
  return imagesOf(note).some((i) => i.startsWith("data:"));
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
  let notes: Note[];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Not a list of notes");
    notes = (parsed as Note[]).map((n) => ({
      ...n,
      font: n.font ?? NoteFont.Default,
      images: n.images ?? [],
      linkPreviews: n.linkPreviews ?? [],
      reminder: n.reminder ?? null,
    }));
  } catch {
    setAside(raw);
    return [];
  }
  cached = { raw, notes };
  return notes.slice();
}

/** Where a list that would not read is kept, one key for each time. */
const SET_ASIDE_PREFIX = `${STORAGE_KEY}:unreadable:`;

/**
 * Moves a list that does not read out of the way, so the app starts empty
 * instead of writing the next note over it, and someone can still get the
 * words back by hand. Throws when storage will not take the copy: the list
 * then stays where it is, and the load fails rather than a save replacing it.
 */
function setAside(raw: string): void {
  const key = `${SET_ASIDE_PREFIX}${Date.now()}`;
  localStorage.setItem(key, raw);
  localStorage.removeItem(STORAGE_KEY);
  cached = null;
  console.error(`The stored notes did not read, and were moved to ${key}`);
}

/** Whether a list was set aside: its images are still its own. */
function hasSetAside(): boolean {
  for (let i = 0; i < localStorage.length; i++) {
    if (localStorage.key(i)?.startsWith(SET_ASIDE_PREFIX)) return true;
  }
  return false;
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
  async changesSince(): Promise<NoteChanges | null> {
    return null;
  }

  async getAll(): Promise<Note[]> {
    const notes = loadNotes();
    if (notes.some(holdsInline)) {
      // A note whose images cannot be moved (IndexedDB unavailable or full, a
      // URL that will not decode) keeps them inline, where they still show;
      // the move is tried again on the next load. Failing here would leave an
      // empty board for notes that loaded fine before.
      const moved: Note[] = [];
      for (const note of notes) {
        try {
          moved.push(
            holdsInline(note)
              ? {
                  ...note,
                  images: await storeInline(note.images),
                  linkPreviews: await storeInlinePreviews(note.linkPreviews),
                }
              : note,
          );
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
    // A list set aside names images too, and nothing can say which.
    if (!hasSetAside()) {
      // A kept draft names images no note does yet.
      void openModeImageRefs()
        .then((kept) =>
          sweepLocalImages(
            new Set([...current.flatMap(imagesOf), ...kept]),
            LOCAL_IMAGE_GRACE_MS,
          ),
        )
        .catch(() => {});
    }
    return current;
  }

  async get(id: string): Promise<Note | null> {
    return loadNotes().find((n) => n.id === id) ?? null;
  }

  async create(input: NoteCreate, options: CreateOptions = {}): Promise<Note> {
    const images = await storeInline(input.images ?? []);
    const linkPreviews = await storeInlinePreviews(input.linkPreviews ?? []);
    const notes = loadNotes();
    const now = new Date().toISOString();
    const note: Note = {
      id: options.id ?? ulid(),
      title: input.title ?? "",
      content: input.content ?? "",
      color: input.color ?? NoteColor.Default,
      font: input.font ?? NoteFont.Default,
      pinned: input.pinned ?? false,
      archived: input.archived ?? false,
      trashed: input.trashed ?? false,
      trashedAt: input.trashedAt ?? null,
      position: input.position ?? -Date.now(),
      tags: input.tags ?? [],
      images,
      ...(input.imageAlts !== undefined && { imageAlts: input.imageAlts }),
      linkPreviews,
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
    if (changes.linkPreviews) {
      changes = {
        ...changes,
        linkPreviews: await storeInlinePreviews(changes.linkPreviews),
      };
    }
    const notes = loadNotes();
    const index = notes.findIndex((n) => n.id === id);
    const current = notes[index];
    if (!current) throw new Error(`Note not found: ${id}`);
    const updated: Note = {
      ...current,
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
      stored.push({
        ...note,
        images: await storeInline(note.images),
        linkPreviews: await storeInlinePreviews(note.linkPreviews ?? []),
      });
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
    version: { title: string; content: string; timestamp?: string },
  ): Promise<void> {
    saveVersion(noteId, version.title, version.content, version.timestamp);
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
}
