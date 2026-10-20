import type { Note, NoteCreate, NoteUpdate } from "@manifesto/shared";
import {
  carriedImageAlts,
  hasUnloadedImages,
  PERSONAL_NOTE_FIELDS,
  roleOf,
  SHARED_NOTE_FIELDS,
  TRASH_RETENTION_DAYS,
} from "@manifesto/shared";
import { batch, computed, effect, signal } from "@preact/signals";
import type { MessageKey } from "#/i18n/index.ts";
import {
  currentStorage,
  LocalStorageAdapter,
  storage,
  storageConnection,
} from "#/storage/index.ts";
import { subscribeToExternalNotes } from "#/storage/LocalStorageAdapter.ts";
import { NoteConflictError } from "#/storage/RestApiAdapter.ts";
import { type StorageKeys, storageKeys } from "#/storage/sealing.ts";
import { deleteVersions } from "#/storage/VersionStorage.ts";
import {
  clearAutoNoteOverride,
  isGeneratedNoteId,
  overrideFrom,
  updateAutoNoteOverride,
} from "./autoNoteOverrides.ts";
import { generatedNotes } from "./autoNotes.ts";
import { asBatch, type Batch, reportFailure } from "./failures.ts";
import { foldIncoming, foldIncomingList, sameValue } from "./incomingNote.ts";
import { mergeNoteUpdate } from "./mergeNote.ts";
import { headPosition } from "./ordering.ts";
import { createPendingWrites } from "./pendingWrites.ts";
import { pickDefaultColor, pickDefaultFont } from "./prefs.ts";

/**
 * The notes, and the actions that talk to storage about them.
 *
 * Each copy of a note that storage sends back (a reply, a broadcast, a listing)
 * comes in through {@link receiveNote} or {@link receiveNoteList}. They apply
 * the writes that are not complete again on top of it. Thus, a late reply
 * cannot undo a newer click. A note goes out through {@link forgetNote}.
 */

export const notes = signal<Note[]>([]);

/**
 * If the note list was read at least one time. Until then, an empty `notes`
 * means "not known yet", not "none". Thus, the board must not say that it is
 * empty. A failed load leaves it false.
 */
export const notesLoaded = signal(false);

/**
 * Each note as storage last sent it, before the code applied the open writes
 * again on top. A write that fails goes back to this, not to the note as the
 * board showed it at the click. A newer copy can have arrived since then. If
 * the code put the older copy back, the board would stay behind the server
 * until something else changed the note.
 */
const confirmed = new Map<string, Note>();

/**
 * Where the last read of the full list stopped, in connected mode. Thus, the
 * next read can ask for what changed since then, not for all notes. Null until
 * a read set it, and each time that the list stops to be a known copy.
 */
let syncCheckpoint: string | null = null;

// When a session ends (a sign-out, or a 401), the notes of the account go out
// of memory with it. The empty list also stops their reminders. The scheduler
// follows `notes`, and gives the empty list to the service worker. Thus, a
// signed-out browser does not show the notes of a different account as
// notifications.
let sessionToken: string | null = null;
let sessionKeys: StorageKeys | null = null;
effect(() => {
  const { serverUrl, token } = storageConnection.value;
  const keys = storageKeys.value;
  const signedOut =
    serverUrl !== null && token === null && sessionToken !== null;
  // Locked again, or started again under new keys: the data in memory was
  // opened with keys that do not apply now.
  const relocked = sessionKeys !== null && keys !== sessionKeys;
  if (signedOut || relocked) {
    confirmed.clear();
    notes.value = [];
    notesLoaded.value = false;
  }
  // A checkpoint tells what this list already has of the notes of one account.
  if (token !== sessionToken || relocked) syncCheckpoint = null;
  sessionToken = token;
  sessionKeys = keys;
});

/**
 * All notes that the UI can see: user notes, and read-only notes that plugins
 * generate. `autoNotes.toNote` merges in their metadata that the user set.
 */
export const allNotes = computed<Note[]>(() => [
  ...notes.value,
  ...generatedNotes.value,
]);

/**
 * Insert or replace a note by id. A connected server broadcasts `note:created`
 * before our own POST resolves. Thus, an insert must be idempotent by id. If
 * not, the same note is in the list two times.
 */
export function upsertById(list: Note[], note: Note): Note[] {
  const idx = list.findIndex((n) => n.id === note.id);
  if (idx === -1) return [...list, note];
  const next = list.slice();
  next[idx] = note;
  return next;
}

/**
 * Writes that show before storage answered for them. See `pendingWrites.ts`.
 */
const pendingWrites = createPendingWrites();

/**
 * The newer of a copy of a note and the copy that the store already took in.
 * Replies and broadcasts go separately (HTTP and the socket), and a 412 carries
 * the note as it was when the server refused the write. Thus, an older copy can
 * arrive after a newer copy. If the store took it in, it would put the board
 * back behind the server. `updatedAt` is the version of the note on the server.
 * It is the same for all persons on the note and never goes backward (`nowIso`
 * is monotonic in its one process). Thus, a comparison of it tells which copy
 * is newer.
 */
function newer(note: Note): Note {
  const known = confirmed.get(note.id);
  return known !== undefined && note.updatedAt < known.updatedAt ? known : note;
}

/**
 * Take in a note as storage has it. The store drops a copy that tells nothing
 * new, and does not write it. Thus, when we get our own change two times (the
 * reply and the broadcast), it costs one render.
 */
export function receiveNote(incoming: Note): void {
  // A stale copy also draws again, from the newer copy. A write that just
  // settled must stop to be applied again in both cases.
  const note = newer(incoming);
  confirmed.set(note.id, note);
  const list = notes.peek();
  const held = list.find((n) => n.id === note.id);
  const next = pendingWrites.replay(foldIncoming(held, note));
  if (held && sameValue(held, next)) return;
  notes.value = upsertById(list, next);
}

/**
 * Take in a full listing as storage has it. Notes that did not change keep
 * their identity. Thus, a new fetch of a board without changes costs no render.
 */
export function receiveNoteList(listed: Note[]): void {
  // A copy newer than the listing can have arrived while the listing was on its
  // way.
  const incoming = listed.map(newer);
  confirmed.clear();
  for (const note of incoming) confirmed.set(note.id, note);
  const held = notes.peek();
  let next = foldIncomingList(held, incoming);
  if (next.some((n) => pendingWrites.pending(n.id))) {
    next = next.map((n) => pendingWrites.replay(n));
  }
  if (next !== held) notes.value = next;
}

/**
 * Drop a note that storage does not have now, or that this user cannot see now.
 */
export function forgetNote(id: string): void {
  confirmed.delete(id);
  const held = notes.peek();
  if (held.some((n) => n.id === id)) {
    notes.value = held.filter((n) => n.id !== id);
  }
}

/** Change the held copy of one note, and do not write it to any place. */
export function reviseNote(id: string, revise: (note: Note) => Note): void {
  const held = notes.peek();
  if (!held.some((n) => n.id === id)) return;
  notes.value = held.map((n) => (n.id === id ? revise(n) : n));
}

// The edits of a different tab, in open mode. Server mode gets the same over
// the WebSocket, and never writes this key.
if (typeof window !== "undefined") {
  subscribeToExternalNotes((next) => {
    if (currentStorage.value instanceof LocalStorageAdapter) {
      receiveNoteList(next);
    }
  });
}

export async function loadNotes(): Promise<boolean> {
  try {
    const changes = await storage.changesSince(null);
    if (changes) {
      receiveNoteList(changes.notes);
      syncCheckpoint = changes.checkpoint;
    } else {
      receiveNoteList(await storage.getAll());
    }
    notesLoaded.value = true;
    await expireTrash();
    return true;
  } catch (err) {
    reportFailure("Failed to load notes:", err, "error.loadFailed");
    return false;
  }
}

/**
 * Get what changed while the list did not listen: a reconnect, where writes
 * made on a different device arrived in no other place. Asks only for what
 * changed since the last read. It reads all notes when there is no checkpoint,
 * when the storage keeps none, or when the catch-up fails.
 *
 * A held note that is not in the ids was deleted or taken away. But the ids can
 * decide only about a note held before the request went out. A note that
 * arrived after that (a reply to a create, a broadcast) can be newer than the
 * answer of the server. If the store dropped it, it would lose a note that
 * exists.
 */
export async function syncNotes(): Promise<boolean> {
  const since = syncCheckpoint;
  if (since === null) return loadNotes();
  const heldBefore = notes.peek().map((n) => n.id);
  let changes: Awaited<ReturnType<typeof storage.changesSince>>;
  try {
    changes = await storage.changesSince(since);
  } catch {
    changes = null;
  }
  if (!changes) {
    syncCheckpoint = null;
    return loadNotes();
  }
  const visible = new Set(changes.ids);
  batch(() => {
    for (const note of (changes as NonNullable<typeof changes>).notes) {
      receiveNote(note);
    }
    for (const id of heldBefore) {
      if (!visible.has(id)) forgetNote(id);
    }
  });
  syncCheckpoint = changes.checkpoint;
  await expireTrash();
  return true;
}

/**
 * Concurrent callers share one request. A card and the editor over it ask at
 * the same moment.
 */
const imageLoads = new Map<string, Promise<string[]>>();

/**
 * The attachments of a note, loaded if a listing did not include them.
 *
 * `null` means that the code could not get the bytes, which is not the same as
 * a note that has none. A caller that writes an images array back, or
 * serializes one, must not read a failure as an empty note. If it does, it
 * replaces each attachment with nothing.
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

/** A full new note from what was given, with each default filled. */
export function noteCreateFrom(input: Partial<NoteCreate>): NoteCreate {
  return {
    title: input.title ?? "",
    content: input.content ?? "",
    color: input.color ?? pickDefaultColor(),
    font: input.font ?? pickDefaultFont(),
    pinned: input.pinned ?? false,
    archived: input.archived ?? false,
    trashed: input.trashed ?? false,
    trashedAt: input.trashedAt ?? null,
    position: input.position ?? headPosition(notes.peek()),
    tags: input.tags ?? [],
    images: input.images ?? [],
    ...(input.imageAlts?.some((alt) => alt !== "") && {
      imageAlts: input.imageAlts,
    }),
    linkPreviews: input.linkPreviews ?? [],
    reminder: input.reminder ?? null,
  };
}

export async function createNote(
  input: Partial<NoteCreate>,
): Promise<Note | null> {
  const noteCreate = noteCreateFrom(input);
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
 * Why the server would refuse a change to a note shared with this user, or null
 * if it would not. The server decides. This asks the same rule first. Thus, the
 * user gets a sentence, not a failed request.
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
 * `changes`, with the descriptions of the images kept in agreement. A write of
 * only `images` moves each description to the new position of its image, and
 * drops the descriptions of the images that it removed. Without it, open mode
 * would keep the old list of descriptions against the new list of images.
 */
function withImageAlts(base: Note | null, changes: NoteUpdate): NoteUpdate {
  if (
    !base?.imageAlts ||
    changes.images === undefined ||
    changes.imageAlts !== undefined
  ) {
    return changes;
  }
  return { ...changes, imageAlts: carriedImageAlts(base, changes.images) };
}

/**
 * Shows `changes` immediately, sends them, and folds the answer in. A 412 is
 * merged three ways against the copy of the server, and tried again one time.
 * `batch` is where a failure is counted when this is one of a group.
 */
export async function updateNote(
  id: string,
  changes: NoteUpdate,
  batch?: Batch,
): Promise<boolean> {
  return (await updateStoredNote(id, changes, batch)) !== null;
}

/**
 * `updateNote` for a caller that needs the note as this write left it: the
 * reply to the write itself, never the copy that the list has when the reply
 * arrives. A broadcast of the write of a different person can arrive while the
 * reply is in a read, and the list then has that copy. `null` when the write
 * failed.
 */
export async function updateStoredNote(
  id: string,
  requested: NoteUpdate,
  batch?: Batch,
): Promise<Note | null> {
  // An auto-note keeps its metadata in the override sidecar. Its title and
  // content belong to the plugin. It is in `generatedNotes`, never in `notes`,
  // and reads back there with the override on top. Null only when the plugin
  // does not make the note now.
  if (isGeneratedNoteId(id)) {
    updateAutoNoteOverride(id, overrideFrom(requested));
    return generatedNotes.value.find((n) => n.id === id) ?? null;
  }
  const base = notes.value.find((n) => n.id === id) ?? null;
  const changes = withImageAlts(base, requested);
  const refusal = base ? refusalFor(base, changes) : null;
  if (refusal) {
    reportFailure(
      `Refused change to shared note ${id}:`,
      changes,
      refusal,
      batch,
    );
    return null;
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
    return note;
  } catch (err) {
    if (err instanceof NoteConflictError && base) {
      const merged = mergeNoteUpdate(base, changes, err.currentNote);
      try {
        const note = await storage.update(id, merged, {
          ifMatch: err.currentNote.updatedAt,
        });
        pendingWrites.settle(id, changes);
        receiveNote(note);
        return note;
      } catch (retryErr) {
        pendingWrites.settle(id, changes);
        receiveNote(
          retryErr instanceof NoteConflictError
            ? retryErr.currentNote
            : (confirmed.get(id) ?? err.currentNote),
        );
        reportFailure(
          `Conflict retry failed for note ${id}:`,
          retryErr,
          "error.saveFailed",
          batch,
        );
        return null;
      }
    }
    // The write never arrived. Thus, what it showed is also removed: back to
    // what storage last confirmed, with each newer local write still on top.
    pendingWrites.settle(id, changes);
    const truth = confirmed.get(id) ?? base;
    if (truth) receiveNote(truth);
    reportFailure(
      `Failed to update note ${id}:`,
      err,
      "error.saveFailed",
      batch,
    );
    return null;
  }
}

/**
 * Deletes a note permanently. On an auto-note, this clears its override. The
 * plugin still makes it, in its default state.
 */
export async function deleteNote(id: string, batch?: Batch): Promise<boolean> {
  if (isGeneratedNoteId(id)) {
    clearAutoNoteOverride(id);
    return true;
  }
  const held = notes.value.find((n) => n.id === id) ?? null;
  const known = confirmed.get(id);
  forgetNote(id);
  try {
    await storage.delete(id);
    deleteVersions(id);
    return true;
  } catch (err) {
    // Back as it was, with the copy that storage last confirmed. A write that
    // fails later goes back to that copy.
    if (known && !confirmed.has(id)) confirmed.set(id, known);
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
  // Read again, and do not think that none are left. A partial failure leaves
  // some.
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
 * Deletes the notes that were in the trash for longer than their time. Only
 * open mode. A server runs the same job itself, against its own clock, for all
 * devices at the same time.
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
