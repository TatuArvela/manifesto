import {
  type LinkPreview,
  type Note,
  type NoteCreate,
  NoteLimitError,
  upgradeNoteWords,
} from "@manifesto/shared";
import { batch, effect, signal, untracked } from "@preact/signals";
import { ulid } from "ulid";
import { storage, storageConnection } from "#/storage/index.ts";
import {
  dropOffline,
  keepOffline,
  type OfflineOwner,
  readOffline,
} from "#/storage/offlineNotes.ts";
import { ImageUploadError, RequestError } from "#/storage/RestApiAdapter.ts";
import { LockedError, storageKeys } from "#/storage/sealing.ts";
import {
  type ComposerDraft,
  isEmptyDraft,
  loadDraft,
  replaceDraft,
} from "./composerDraft.ts";
import { applyLinkPreviews } from "./linkPreviews.ts";
import { createNote, noteCreateFrom, receiveNote } from "./notesStore.ts";
import {
  imageKeysOf,
  keptFields,
  offlineOwner,
  restoreImageKeys,
} from "./offlineOwner.ts";
import { newNoteRequested } from "./ui.ts";

/**
 * New notes that the server did not take yet, in connected mode. A close of the
 * composer queues the note here. It does not only send it. The note is kept on
 * the device (sealed, `storage/offlineNotes.ts`) before it is sent. It is sent
 * again each time there is a reason to think that the server is available (the
 * browser goes back online, the app socket reconnects, the account unlocks),
 * until it arrives.
 *
 * The id of each note is selected when it is queued. Thus, to send it again is
 * safe. A write that arrived, but whose answer was lost, gets a 409 the next
 * time, and the code takes the note found under that id as the note that it
 * sent.
 *
 * In open mode, a note is stored in this browser immediately, and nothing
 * waits.
 */

export interface UnsentNote {
  id: string;
  note: NoteCreate;
  /**
   * The server refused it for its content (for example, too long), not because
   * the server was not available. It is not sent again until it changes.
   */
  refused: boolean;
}

/** In the order in which they were written. */
export const unsentNotes = signal<UnsentNote[]>([]);

/**
 * The note that is sent at this moment, which cannot be taken back in the
 * meantime.
 */
export const sendingNoteId = signal<string | null>(null);

/**
 * If the first try to send each note is complete. Until it is, the note does
 * not show as waiting. Thus, a note sent in a moment never shows as unsent for
 * an instant on its way to the board.
 */
export const settledNoteIds = signal<ReadonlySet<string>>(new Set());

/** What occurs to a note that the server did not take. */
export type SendFailure = "later" | "taken" | "refused";

/**
 * Why a send failed, as what to do next. `later` when the server was not
 * available, or does not take notes at the moment. `taken` when a note with the
 * id already exists (possibly this note, whose answer was lost). `refused` when
 * a send of it as it is will never work.
 */
export function sendFailure(err: unknown): SendFailure {
  if (err instanceof RequestError) {
    if (err.status === 409) return "taken";
    if (
      err.status === 401 ||
      err.status === 408 ||
      err.status === 429 ||
      err.status >= 500
    ) {
      return "later";
    }
    return "refused";
  }
  if (err instanceof ImageUploadError) {
    return err.status === 0 || err.status === 429 || err.status >= 500
      ? "later"
      : "refused";
  }
  // Locked: the note is sent after the account is unlocked again.
  if (err instanceof LockedError) return "later";
  if (err instanceof NoteLimitError) return "refused";
  // `fetch` rejects with a TypeError when no answer came back.
  if (err instanceof TypeError) return "later";
  return "refused";
}

/** If `unsentNotes` contains what was kept for the account that is unlocked. */
let loaded = false;
let generation = 0;
/**
 * For what `unsentNotes` was read. Thus, when neither changes, nothing is read.
 */
let loadedFor: { token: string | null; keys: unknown } | null = null;

/**
 * Previews that were still loading when a note was queued, applied after it
 * arrives.
 */
const loadingPreviews = new Map<string, Promise<LinkPreview | null>[]>();

interface KeptUnsent {
  note: NoteCreate;
  imageKeys: Record<string, unknown>;
  refused: boolean;
}

function keep(owner: OfflineOwner, entry: UnsentNote): Promise<boolean> {
  const record: KeptUnsent = {
    note: entry.note,
    imageKeys: imageKeysOf(entry.note.images, entry.note.linkPreviews),
    refused: entry.refused,
  };
  return keepOffline(owner, "unsent", entry.id, record);
}

function fromRecord(
  id: string,
  raw: unknown,
  format: number,
): UnsentNote | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Partial<Record<keyof KeptUnsent, unknown>>;
  if (typeof record.note !== "object" || record.note === null) return null;
  const note = record.note as Record<string, unknown>;
  restoreImageKeys(record.imageKeys);
  const { imageAlts, ...fields } = upgradeNoteWords(keptFields(note), format);
  return {
    id,
    note: noteCreateFrom({
      ...fields,
      ...(imageAlts.length > 0 && { imageAlts }),
      ...(typeof note.position === "number" && { position: note.position }),
    }),
    refused: record.refused === true,
  };
}

function settle(id: string): void {
  // Arrived: there is nothing left to show.
  if (!unsentNotes.peek().some((e) => e.id === id)) return;
  if (settledNoteIds.peek().has(id)) return;
  settledNoteIds.value = new Set([...settledNoteIds.peek(), id]);
}

function without(id: string): void {
  unsentNotes.value = unsentNotes.peek().filter((e) => e.id !== id);
  loadingPreviews.delete(id);
  if (settledNoteIds.peek().has(id)) {
    const next = new Set(settledNoteIds.peek());
    next.delete(id);
    settledNoteIds.value = next;
  }
}

function replace(entry: UnsentNote): void {
  unsentNotes.value = unsentNotes
    .peek()
    .map((e) => (e.id === entry.id ? entry : e));
}

/**
 * Saves a new note: in open mode immediately, and in connected mode through the
 * queue. Thus, a note written without a connection is kept until there is one.
 * When locked, there is nothing with which to seal it, and it goes directly to
 * storage as before. Resolves with if the note was kept. Never rejects.
 */
export async function queueNote(
  input: Partial<NoteCreate>,
  pending: Promise<LinkPreview | null>[] = [],
): Promise<boolean> {
  const owner = offlineOwner();
  if (!owner?.keys) {
    const note = await createNote(input);
    if (note && pending.length > 0) void applyLinkPreviews(note.id, pending);
    return note !== null;
  }
  const entry: UnsentNote = {
    id: ulid(),
    note: noteCreateFrom(input),
    refused: false,
  };
  unsentNotes.value = [...unsentNotes.peek(), entry];
  if (pending.length > 0) loadingPreviews.set(entry.id, pending);
  // Kept before it is sent. Thus, a page put away during the request loses
  // nothing.
  await keep(owner, entry);
  void sendUnsent();
  return true;
}

function landed(
  entry: UnsentNote,
  note: Note,
  sentFor: { run: number; ownerId: string },
): void {
  void dropOffline(sentFor.ownerId, "unsent", entry.id);
  // The session or the keys changed while it was on its way. The list from
  // which it was sent is gone, and the note belongs to no list here now.
  if (sentFor.run !== generation) return;
  const pending = loadingPreviews.get(entry.id);
  batch(() => {
    without(entry.id);
    receiveNote(note);
  });
  if (pending) void applyLinkPreviews(note.id, pending);
}

async function refuse(entry: UnsentNote): Promise<void> {
  const refused = { ...entry, refused: true };
  replace(refused);
  const owner = offlineOwner();
  if (owner?.keys) await keep(owner, refused);
}

/** Sends one note, and tells if to continue to the next. */
async function sendOne(
  entry: UnsentNote,
  ownerId: string,
): Promise<"next" | "stop"> {
  const sentFor = { run: generation, ownerId };
  sendingNoteId.value = entry.id;
  try {
    const note = await storage.create(entry.note, { id: entry.id });
    landed(entry, note, sentFor);
    return "next";
  } catch (err) {
    const failure = sendFailure(err);
    if (failure === "taken") {
      let found: Note | null;
      try {
        found = await storage.get(entry.id);
      } catch {
        return "stop";
      }
      if (found) {
        landed(entry, found, sentFor);
        return "next";
      }
      await refuse(entry);
      return "next";
    }
    if (failure === "refused") {
      console.warn(`The server refused unsent note ${entry.id}:`, err);
      await refuse(entry);
      return "next";
    }
    return "stop";
  } finally {
    settle(entry.id);
    sendingNoteId.value = null;
  }
}

async function sendAll(): Promise<void> {
  for (const entry of unsentNotes.peek()) {
    // Signed out, locked, or a different account: the remaining notes wait for
    // it.
    const owner = offlineOwner();
    if (!owner?.keys || !loaded) return;
    // Taken back into the composer, or discarded, while the previous note went.
    const current = unsentNotes.peek().find((e) => e.id === entry.id);
    if (!current || current.refused) continue;
    if ((await sendOne(current, owner.id)) === "stop") return;
  }
}

/**
 * Two tabs of one browser send one at a time. The 409 covers the remaining
 * cases.
 */
async function oneTabAtATime(work: () => Promise<void>): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return work();
  await locks.request("manifesto:unsent-notes", work);
}

let sending: Promise<void> | null = null;
let sendAgain = false;

/**
 * Sends all that waits. A call while a round is in progress asks for another
 * round after it, because the note that it brings can have missed this round.
 * Never rejects.
 */
export function sendUnsent(): Promise<void> {
  if (sending) {
    sendAgain = true;
    return sending;
  }
  sending = (async () => {
    do {
      sendAgain = false;
      try {
        await oneTabAtATime(sendAll);
      } catch (err) {
        console.warn("Failed to send unsent notes:", err);
      }
    } while (sendAgain);
  })().finally(() => {
    sending = null;
  });
  return sending;
}

/** The fields of an unsent note, as the composer has them. */
function asDraft(note: NoteCreate): ComposerDraft {
  return {
    title: note.title,
    content: note.content,
    color: note.color,
    font: note.font,
    pinned: note.pinned,
    tags: note.tags,
    images: note.images,
    imageAlts: note.imageAlts ?? [],
    linkPreviews: note.linkPreviews,
  };
}

/**
 * Takes an unsent note back into the composer for a change, and opens it. The
 * code does not write over a draft that is already kept. It is queued in its
 * place. False when the note is sent at this moment.
 */
export async function reopenUnsent(id: string): Promise<boolean> {
  const entry = unsentNotes.peek().find((e) => e.id === id);
  if (!entry || sendingNoteId.peek() === id) return false;
  without(id);
  const kept = await loadDraft();
  if (kept && !isEmptyDraft(kept)) void queueNote(kept);
  await replaceDraft(asDraft(entry.note));
  const owner = offlineOwner();
  if (owner) await dropOffline(owner.id, "unsent", id);
  newNoteRequested.value = true;
  return true;
}

/** Forgets an unsent note. False when it is sent at this moment. */
export async function discardUnsent(id: string): Promise<boolean> {
  if (sendingNoteId.peek() === id) return false;
  without(id);
  const owner = offlineOwner();
  if (owner) await dropOffline(owner.id, "unsent", id);
  return true;
}

/**
 * Reads the notes kept for the account that is unlocked now, and sends them.
 * Runs each time the session or the keys change. A sign-out or a lock empties
 * the list, because nothing in it could be sent, and an unlock fills it again.
 */
async function load(): Promise<void> {
  const token = storageConnection.peek().token;
  const keys = storageKeys.peek();
  if (loadedFor?.token === token && loadedFor.keys === keys) return;
  loadedFor = { token, keys };
  const run = ++generation;
  loaded = false;
  batch(() => {
    unsentNotes.value = [];
    settledNoteIds.value = new Set();
  });
  loadingPreviews.clear();
  const owner = offlineOwner();
  if (!owner?.keys) return;
  const records = await readOffline(owner, "unsent");
  if (run !== generation) return;
  const kept: UnsentNote[] = [];
  for (const record of records) {
    const entry = fromRecord(record.id, record.value, record.format);
    if (entry) kept.push(entry);
  }
  // In the order in which they were written, which is the order of a ULID.
  kept.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // A note queued while they were read stays, after them.
  const queued = unsentNotes.peek();
  const known = new Set(kept.map((e) => e.id));
  batch(() => {
    unsentNotes.value = [...kept, ...queued.filter((e) => !known.has(e.id))];
    settledNoteIds.value = new Set([...settledNoteIds.peek(), ...known]);
  });
  loaded = true;
  void sendUnsent();
}

effect(() => {
  void storageConnection.value;
  void storageKeys.value;
  untracked(() => void load());
});

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void sendUnsent());
}
