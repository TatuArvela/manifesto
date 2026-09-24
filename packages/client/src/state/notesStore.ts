import type { Note, NoteCreate, NoteUpdate } from "@manifesto/shared";
import {
  hasUnloadedImages,
  PERSONAL_NOTE_FIELDS,
  roleOf,
  SHARED_NOTE_FIELDS,
  TRASH_RETENTION_DAYS,
} from "@manifesto/shared";
import { computed, signal } from "@preact/signals";
import type { MessageKey } from "../i18n/index.js";
import {
  currentStorage,
  LocalStorageAdapter,
  storage,
} from "../storage/index.js";
import { subscribeToExternalNotes } from "../storage/LocalStorageAdapter.js";
import { NoteConflictError } from "../storage/RestApiAdapter.js";
import { deleteVersions } from "../storage/VersionStorage.js";
import {
  clearAutoNoteOverride,
  isGeneratedNoteId,
  overrideFrom,
  updateAutoNoteOverride,
} from "./autoNoteOverrides.js";
import { generatedNotes } from "./autoNotes.js";
import { asBatch, type Batch, reportFailure } from "./failures.js";
import { foldIncoming, foldIncomingList, sameValue } from "./incomingNote.js";
import { mergeNoteUpdate } from "./mergeNote.js";
import { headPositions } from "./ordering.js";
import { createPendingWrites } from "./pendingWrites.js";
import { pickDefaultColor, pickDefaultFont } from "./prefs.js";

/**
 * The notes and the actions that talk to storage about them.
 *
 * Every copy of a note that storage sends back (a reply, a broadcast, a
 * listing) comes in through {@link receiveNote} or {@link receiveNoteList},
 * which replay the writes still outstanding on top of it, so a late reply
 * cannot revert a newer click. A note leaves through {@link forgetNote}.
 */

export const notes = signal<Note[]>([]);

/**
 * Whether the note list has been read at least once. Until it has, an empty
 * `notes` means "not known yet" rather than "none", so the board must not say
 * there is nothing on it. A failed load leaves it false.
 */
export const notesLoaded = signal(false);

/**
 * All notes visible to the UI: user notes plus plugin-generated read-only
 * notes, whose user-set metadata is merged in by `autoNotes.toNote`.
 */
export const allNotes = computed<Note[]>(() => [
  ...notes.value,
  ...generatedNotes.value,
]);

/**
 * Insert or replace a note by id. A connected server broadcasts
 * `note:created` before our own POST resolves, so an insert must be
 * idempotent by id or the same note lands in the list twice.
 */
export function upsertById(list: Note[], note: Note): Note[] {
  const idx = list.findIndex((n) => n.id === note.id);
  if (idx === -1) return [...list, note];
  const next = list.slice();
  next[idx] = note;
  return next;
}

/** Writes shown before storage has answered for them; see `pendingWrites.ts`. */
const pendingWrites = createPendingWrites();

/**
 * Take in a note as storage has it. A copy that says nothing new is dropped
 * rather than written, so hearing about our own change twice (the reply and
 * the broadcast) costs one render.
 */
export function receiveNote(note: Note): void {
  const list = notes.peek();
  const held = list.find((n) => n.id === note.id);
  const next = pendingWrites.replay(foldIncoming(held, note));
  if (held && sameValue(held, next)) return;
  notes.value = upsertById(list, next);
}

/**
 * Take in a whole listing as storage has it. Notes that did not change keep
 * their identity, so a re-fetch of an unchanged board costs no render.
 */
export function receiveNoteList(incoming: Note[]): void {
  const held = notes.peek();
  let next = foldIncomingList(held, incoming);
  if (next.some((n) => pendingWrites.pending(n.id))) {
    next = next.map((n) => pendingWrites.replay(n));
  }
  if (next !== held) notes.value = next;
}

/** Drop a note that storage no longer has, or this user can no longer see. */
export function forgetNote(id: string): void {
  const held = notes.peek();
  if (held.some((n) => n.id === id)) {
    notes.value = held.filter((n) => n.id !== id);
  }
}

/** Change the held copy of one note without writing it anywhere. */
export function reviseNote(id: string, revise: (note: Note) => Note): void {
  const held = notes.peek();
  if (!held.some((n) => n.id === id)) return;
  notes.value = held.map((n) => (n.id === id ? revise(n) : n));
}

// Another tab's edits, in open mode. Server mode hears the same over the
// WebSocket and never writes this key.
if (typeof window !== "undefined") {
  subscribeToExternalNotes((next) => {
    if (currentStorage.value instanceof LocalStorageAdapter) {
      receiveNoteList(next);
    }
  });
}

export async function loadNotes(): Promise<boolean> {
  try {
    receiveNoteList(await storage.getAll());
    notesLoaded.value = true;
    await expireTrash();
    return true;
  } catch (err) {
    reportFailure("Failed to load notes:", err, "error.loadFailed");
    return false;
  }
}

/** Concurrent callers share one request: a card and the editor over it ask at
 * the same moment. */
const imageLoads = new Map<string, Promise<string[]>>();

/**
 * The attachments of a note, fetched if a listing left them behind.
 *
 * `null` means the bytes could not be had, which is not the same as the note
 * having none. A caller that writes an images array back or serializes one
 * must not read a failure as an empty note, or it replaces every attachment
 * with nothing.
 */
export async function ensureImages(id: string): Promise<string[] | null> {
  const note = notes.value.find((n) => n.id === id);
  if (!note) return null;
  if (!hasUnloadedImages(note)) return note.images;

  let load = imageLoads.get(id);
  if (!load) {
    load = storage.loadImages(id).finally(() => imageLoads.delete(id));
    imageLoads.set(id, load);
  }
  try {
    const images = await load;
    reviseNote(id, (n) => ({ ...n, images, imageCount: images.length }));
    return images;
  } catch (err) {
    reportFailure(
      `Failed to load images for note ${id}:`,
      err,
      "error.loadFailed",
    );
    return null;
  }
}

export async function createNote(
  input: Partial<NoteCreate>,
): Promise<Note | null> {
  const noteCreate: NoteCreate = {
    title: input.title ?? "",
    content: input.content ?? "",
    color: input.color ?? pickDefaultColor(),
    font: input.font ?? pickDefaultFont(),
    pinned: input.pinned ?? false,
    archived: input.archived ?? false,
    trashed: input.trashed ?? false,
    trashedAt: input.trashedAt ?? null,
    position: input.position ?? headPositions(notes.peek(), 1)[0],
    tags: input.tags ?? [],
    images: input.images ?? [],
    linkPreviews: input.linkPreviews ?? [],
    reminder: input.reminder ?? null,
  };
  try {
    const note = await storage.create(noteCreate);
    receiveNote(note);
    return note;
  } catch (err) {
    reportFailure("Failed to create note:", err, "error.createFailed");
    return null;
  }
}

const PERSONAL_FIELDS = new Set<string>(PERSONAL_NOTE_FIELDS);
const SHARED_FIELDS = new Set<string>(SHARED_NOTE_FIELDS);

/**
 * Why a change to a note shared with this user would be refused, or null if
 * it would not be. The server decides; this asks the same rule first, so the
 * user is told in a sentence instead of in a failed request.
 */
function refusalFor(note: Note, changes: NoteUpdate): MessageKey | null {
  const role = roleOf(note);
  if (role === "owner") return null;
  const fields = Object.entries(changes)
    .filter(([, value]) => value !== undefined)
    .map(([field]) => field);
  if (fields.some((f) => !PERSONAL_FIELDS.has(f) && !SHARED_FIELDS.has(f))) {
    return "sharing.error.ownerOnly";
  }
  if (role === "view" && fields.some((f) => SHARED_FIELDS.has(f))) {
    return "sharing.error.viewOnly";
  }
  return null;
}

/**
 * Shows `changes` at once, sends them, and folds the answer in. A 412 is
 * merged three ways against the server's copy and retried once. `batch` is
 * where a failure is counted when this is one of a group.
 */
export async function updateNote(
  id: string,
  changes: NoteUpdate,
  batch?: Batch,
): Promise<boolean> {
  // An auto-note keeps its metadata in the override sidecar; its title and
  // content are the plugin's.
  if (isGeneratedNoteId(id)) {
    updateAutoNoteOverride(id, overrideFrom(changes));
    return true;
  }
  const base = notes.value.find((n) => n.id === id) ?? null;
  const refusal = base ? refusalFor(base, changes) : null;
  if (refusal) {
    reportFailure(
      `Refused change to shared note ${id}:`,
      changes,
      refusal,
      batch,
    );
    return false;
  }
  if (base)
    notes.value = upsertById(notes.value, pendingWrites.begin(base, changes));
  try {
    const note = await storage.update(
      id,
      changes,
      base ? { ifMatch: base.updatedAt } : undefined,
    );
    pendingWrites.settle(id, changes);
    receiveNote(note);
    return true;
  } catch (err) {
    if (err instanceof NoteConflictError && base) {
      const merged = mergeNoteUpdate(base, changes, err.currentNote);
      try {
        const note = await storage.update(id, merged, {
          ifMatch: err.currentNote.updatedAt,
        });
        pendingWrites.settle(id, changes);
        receiveNote(note);
        return true;
      } catch (retryErr) {
        pendingWrites.settle(id, changes);
        receiveNote(base);
        reportFailure(
          `Conflict retry failed for note ${id}:`,
          retryErr,
          "error.saveFailed",
          batch,
        );
        return false;
      }
    }
    // The write never landed, so neither does what it showed: back to what
    // storage last confirmed, with any newer local write still on top.
    pendingWrites.settle(id, changes);
    if (base) receiveNote(base);
    reportFailure(
      `Failed to update note ${id}:`,
      err,
      "error.saveFailed",
      batch,
    );
    return false;
  }
}

/**
 * Deletes a note for good. On an auto-note this clears its override; the
 * plugin still produces it, in its default state.
 */
export async function deleteNote(id: string, batch?: Batch): Promise<boolean> {
  if (isGeneratedNoteId(id)) {
    clearAutoNoteOverride(id);
    return true;
  }
  const held = notes.value.find((n) => n.id === id) ?? null;
  forgetNote(id);
  try {
    await storage.delete(id);
    deleteVersions(id);
    return true;
  } catch (err) {
    if (held) notes.value = upsertById(notes.value, held);
    reportFailure(
      `Failed to delete note ${id}:`,
      err,
      "error.deleteFailed",
      batch,
    );
    return false;
  }
}

export async function deleteAllNotes(): Promise<boolean> {
  let ok = true;
  try {
    await storage.deleteAll();
  } catch (err) {
    reportFailure("Failed to delete all notes:", err, "error.deleteFailed");
    ok = false;
  }
  // Re-read rather than assume none are left: a partial failure leaves some.
  try {
    receiveNoteList(await storage.getAll());
  } catch (err) {
    console.error("Failed to re-read notes after deleting:", err);
  }
  return ok;
}

export async function importNotes(imported: Note[]): Promise<boolean> {
  try {
    await storage.importAll(imported);
    receiveNoteList(await storage.getAll());
    return true;
  } catch (err) {
    reportFailure("Failed to import notes:", err, "error.importFailed");
    return false;
  }
}

/**
 * Deletes what has been in the trash past its time. Open mode only: a server
 * runs the same job itself, against its own clock, for every device at once.
 */
export async function expireTrash(): Promise<void> {
  if (!(currentStorage.value instanceof LocalStorageAdapter)) return;
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const expired = notes.value.filter(
    (n) => n.trashed && n.trashedAt && Date.parse(n.trashedAt) < cutoff,
  );
  if (expired.length === 0) return;
  await asBatch((batch) =>
    Promise.all(expired.map((n) => deleteNote(n.id, batch))),
  );
}
