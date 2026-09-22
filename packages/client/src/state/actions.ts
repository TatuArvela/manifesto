import type { Note, NoteCreate, NoteUpdate } from "@manifesto/shared";
import {
  hasUnloadedImages,
  imageCountOf,
  NoteColor,
  NoteFont,
  PERSONAL_NOTE_FIELDS,
  roleOf,
  SHARED_NOTE_FIELDS,
} from "@manifesto/shared";
import { computed, effect, signal } from "@preact/signals";
import { type MessageKey, plural, t } from "../i18n/index.js";
import {
  createStorage,
  currentStorage,
  LocalStorageAdapter,
} from "../storage/index.js";
import { subscribeToExternalNotes } from "../storage/LocalStorageAdapter.js";
import { quotaRefusedAt } from "../storage/quota.js";
import { NoteConflictError } from "../storage/RestApiAdapter.js";
import { deleteVersions } from "../storage/VersionStorage.js";
import {
  isChecklistLine,
  markFencedLines,
  parseChecklistLine,
  removeCheckedItems,
  setChecklistChecked,
} from "../utils/markdown.js";
import {
  clearAutoNoteOverride,
  updateAutoNoteOverride,
} from "./autoNoteOverrides.js";
import { generatedNotes } from "./autoNotes.js";
import { foldIncoming, foldIncomingList, sameValue } from "./incomingNote.js";
import { mergeNoteUpdate } from "./mergeNote.js";
import { createPendingWrites } from "./pendingWrites.js";
import {
  animations,
  defaultNoteColor,
  defaultNoteFont,
  sortMode,
} from "./prefs.js";
import {
  activeTag,
  activeView,
  editingNoteId,
  searchColors,
  searchLocations,
  searchQuery,
  searchTypes,
  selectedNotes,
  selectMode,
  showError,
  tagsShowActive,
  tagsShowArchived,
  tagsShowTrashed,
} from "./ui.js";

// --- Storage ---

const storage = createStorage();

// Another tab's edits, in open mode. Server mode gets the same news over the
// WebSocket and never writes this key, so the listener is scoped to the
// adapter that owns it rather than left to fire against a stale local copy.
if (typeof window !== "undefined") {
  subscribeToExternalNotes((next) => {
    if (currentStorage.value instanceof LocalStorageAdapter) {
      notes.value = next;
    }
  });
}

/**
 * One user action can exhaust the quota several times over (`NoteCardEditor`
 * saves the note and a version), so the message is thrown away for a minute
 * after it is shown, and the user sees one clear sentence rather than a
 * burst. Storage reports the refusal; the wording and the throttle are here.
 */
const QUOTA_MESSAGE_QUIET_MS = 60 * 1000;
let lastQuotaMessageAt = 0;

effect(() => {
  const refusedAt = quotaRefusedAt.value;
  if (refusedAt === 0) return;
  if (refusedAt - lastQuotaMessageAt < QUOTA_MESSAGE_QUIET_MS) return;
  lastQuotaMessageAt = refusedAt;
  showError(t("storage.quotaExceeded"));
});

// --- Signals ---

export const notes = signal<Note[]>([]);

/**
 * All notes visible to the UI: user notes plus plugin-generated read-only
 * notes. Generated notes' metadata (pin/color/tags/archive/trash/reminder)
 * can be overridden by the user; the override sidecar is merged into the
 * rendered note inside `autoNotes.toNote`.
 */
export const allNotes = computed<Note[]>(() => [
  ...notes.value,
  ...generatedNotes.value,
]);

/**
 * Insert or replace a note by id. Optimistic local writes and WebSocket
 * fan-out events race (in server mode the backend broadcasts `note:created`
 * before our own POST resolves), so every local insert must be idempotent by
 * id, otherwise the same note lands in the list twice (a duplicate card that
 * only clears on refetch).
 */
export function upsertById(list: Note[], note: Note): Note[] {
  const idx = list.findIndex((n) => n.id === note.id);
  if (idx === -1) return [...list, note];
  const next = list.slice();
  next[idx] = note;
  return next;
}

/**
 * Writes shown before storage has answered for them. See `pendingWrites.ts`:
 * this is what lets a click change the board at once in connected mode and a
 * late response fold in afterwards without undoing anything newer.
 */
const pendingWrites = createPendingWrites();

/**
 * Take in a note as the server has it: the answer to one of our writes, a
 * broadcast from another device, or a row from a listing.
 *
 * The outstanding local writes are replayed on top, and a copy that turns out
 * to say nothing new is dropped rather than written, so hearing about our own
 * change twice (once as the response, once as the broadcast back to us) costs
 * one render and not three.
 */
export function receiveNote(note: Note): void {
  const list = notes.peek();
  const held = list.find((n) => n.id === note.id);
  const next = pendingWrites.replay(foldIncoming(held, note));
  if (held && sameValue(held, next)) return;
  notes.value = upsertById(list, next);
}

// --- Derived ---

/**
 * Whether a note has any checklist the user can see.
 *
 * Fenced lines are skipped for the same reason the preview skips them: inside
 * a code block `- [x]` is text being quoted, not a box. These three helpers
 * and `segmentContent` have to agree on that, because the menu offers an
 * action based on one and `deleteCheckedItems` carries it out with another,
 * and when they disagreed, a note documenting our own syntax had lines cut out
 * of the middle of its code block.
 */
export function noteHasChecklist(content: string): boolean {
  const lines = content.split("\n");
  const fenced = markFencedLines(lines);
  return lines.some((line, i) => !fenced[i] && isChecklistLine(line));
}

/**
 * Whether the current view has room for a note where it lives: active,
 * archived or trashed, and for the reminders and auto-notes views what kind of
 * note it is. The part of a view's filter that archiving, trashing and
 * restoring change, so they can tell whether the card is about to leave.
 */
function inViewLocation(
  n: Pick<Note, "archived" | "trashed" | "readonly" | "reminder">,
): boolean {
  switch (activeView.value) {
    case "active":
      return !n.archived && !n.trashed;
    case "tags":
      if (n.trashed) return tagsShowTrashed.value;
      if (n.archived) return tagsShowArchived.value;
      return tagsShowActive.value;
    case "reminders":
      return !!n.reminder && !n.trashed;
    case "autoNotes":
      return !!n.readonly && !n.archived && !n.trashed;
    case "archived":
      return n.archived && !n.trashed;
    case "trash":
      return n.trashed;
    case "search": {
      const locations = searchLocations.value;
      if (n.trashed) return locations.has("trashed");
      if (n.archived) return locations.has("archived");
      return locations.has("active");
    }
    default:
      return true;
  }
}

export const filteredNotes = computed(() => {
  let result: Note[] = allNotes.value;

  // Filter by view
  switch (activeView.value) {
    case "active":
    case "reminders":
    case "autoNotes":
    case "archived":
    case "trash":
      result = result.filter(inViewLocation);
      break;
    case "tags":
      result = result.filter(inViewLocation);
      if (activeTag.value) {
        const tag = activeTag.value;
        result = result.filter((n) => n.tags.includes(tag));
      }
      break;
    case "search": {
      const types = searchTypes.value;
      const colors = searchColors.value;
      if (!searchQuery.value && types.size === 0 && colors.size === 0) {
        result = [];
        break;
      }
      result = result.filter(inViewLocation);
      if (types.size > 0) {
        result = result.filter((n) => {
          if (types.has("reminders") && n.reminder) return true;
          if (types.has("images") && imageCountOf(n) > 0) return true;
          if (types.has("urls") && n.linkPreviews.length > 0) return true;
          if (types.has("checklists") && noteHasChecklist(n.content))
            return true;
          return false;
        });
      }
      if (colors.size > 0) {
        result = result.filter((n) => colors.has(n.color));
      }
      break;
    }
  }

  // Filter by search query
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q),
    );
  }

  return result;
});

/**
 * Manual order: by `position`, and by id where two notes share one.
 *
 * The tiebreak is not decoration. Positions are chosen as the midpoint
 * between two neighbours (see `positionBetween`), so two devices reordering
 * the same gap at the same moment can pick the same number, and a note
 * imported from a backup can carry one that already exists. Without a second
 * key the sort falls back to the order the notes happen to be held in, which
 * is the order they were fetched in, and two devices showing the same board
 * disagree about it. Ids are ULIDs and so sort by themselves.
 */
function byPosition(a: Note, b: Note): number {
  return a.position - b.position || a.id.localeCompare(b.id);
}

/**
 * Newest first by a timestamp, parsing each one once. Comparing with
 * `new Date(...)` inside the comparator parsed two strings per comparison,
 * n log n of them for every change to the list. The timestamps are not
 * compared as strings: they are ISO, but not all written the same way (with
 * and without milliseconds), and those do not sort as text. A missing or
 * unreadable one counts as the epoch, and the sort is stable, as before.
 */
function newestFirst(
  list: Note[],
  time: (n: Note) => string | null | undefined,
): Note[] {
  return list
    .map((note) => ({ note, at: Date.parse(time(note) ?? "") || 0 }))
    .sort((a, b) => b.at - a.at)
    .map(({ note }) => note);
}

export const sortedNotes = computed(() => {
  const result = [...filteredNotes.value];
  if (activeView.value === "reminders") {
    result.sort((a, b) =>
      (a.reminder?.time ?? "").localeCompare(b.reminder?.time ?? ""),
    );
    return result;
  }
  if (activeView.value === "trash") {
    return newestFirst(result, (n) => n.trashedAt);
  }
  switch (sortMode.value) {
    case "updated":
      return newestFirst(result, (n) => n.updatedAt);
    case "created":
      return newestFirst(result, (n) => n.createdAt);
    default:
      return result.sort(byPosition);
  }
});

export const pinnedNotes = computed(() =>
  sortedNotes.value.filter((n) => n.pinned),
);

export const unpinnedNotes = computed(() =>
  sortedNotes.value.filter((n) => !n.pinned),
);

export const allTags = computed(() => {
  const tagSet = new Set<string>();
  for (const note of allNotes.value) {
    if (!note.trashed && !note.archived) {
      for (const tag of note.tags) {
        tagSet.add(tag);
      }
    }
  }
  return [...tagSet].sort();
});

export const editingNote = computed(() =>
  editingNoteId.value
    ? (allNotes.value.find((n) => n.id === editingNoteId.value) ?? null)
    : null,
);

/** Drag-and-drop reorder is available in the Notes and Auto-notes views, unfiltered, manual order, no modal open */
export const canReorder = computed(
  () =>
    (activeView.value === "active" || activeView.value === "autoNotes") &&
    sortMode.value === "default" &&
    !searchQuery.value &&
    !editingNoteId.value,
);

// --- Helpers ---

const noteColors = Object.values(NoteColor).filter(
  (c) => c !== NoteColor.Default,
);

export function pickDefaultColor(): NoteColor {
  if (defaultNoteColor.value === "random") {
    return noteColors[Math.floor(Math.random() * noteColors.length)];
  }
  return defaultNoteColor.value;
}

const noteFonts = Object.values(NoteFont).filter((f) => f !== NoteFont.Default);

export function pickDefaultFont(): NoteFont {
  if (defaultNoteFont.value === "random") {
    return noteFonts[Math.floor(Math.random() * noteFonts.length)];
  }
  return defaultNoteFont.value;
}

// --- Actions ---

/**
 * The contract for everything below: an action reports its own failure and
 * resolves. It never rejects, and it says whether it worked in its return
 * value: `false`, or `null` where a value was expected.
 *
 * Throwing does not survive contact with the call sites, which are JSX
 * handlers: `onClick={() => updateNote(...)}` has nowhere to put a `catch`, so
 * a rejection there is an unhandled rejection that the user never sees. The
 * previous arrangement did both (toast *and* rethrow), which meant every
 * caller either ignored the rejection or reported the failure a second time.
 */

interface Batch {
  failures: number;
}

let batch: Batch | null = null;

function reportFailure(context: string, err: unknown, message: MessageKey) {
  console.error(context, err);
  if (batch) {
    batch.failures++;
    return;
  }
  showError(t(message));
}

/**
 * Runs a group of actions as one operation. Their failures are counted rather
 * than each raising its own toast (twenty selected notes that all fail used
 * to mean twenty toasts), and one message names the total at the end. Nested
 * batches join the outer one, so `bulkAddTag` reports once and not twice.
 */
async function asBatch(run: () => Promise<void>): Promise<boolean> {
  const outer = batch;
  const current = outer ?? { failures: 0 };
  batch = current;
  try {
    await run();
  } finally {
    batch = outer;
  }
  if (outer) return current.failures === 0;
  if (current.failures > 0) {
    showError(plural("error.bulkFailed", current.failures));
    return false;
  }
  return true;
}

export async function loadNotes(): Promise<boolean> {
  try {
    // Folded in rather than assigned. A reconnect re-fetches the whole list
    // to catch what happened while the tab was offline, and on a board that
    // did not change in the meantime that must cost nothing: assigning a
    // freshly parsed array re-rendered every card and re-ran the masonry pass
    // for notes that had not moved, and dropped the attachments the cards had
    // already fetched.
    notes.value = foldIncomingList(notes.peek(), await storage.getAll());
    await expireTrash();
    return true;
  } catch (err) {
    reportFailure("Failed to load notes:", err, "error.loadFailed");
    return false;
  }
}

/**
 * The attachments of a note, fetched if the listing left them behind.
 *
 * A server listing sends `imageCount` and an empty `images`, so anything that
 * needs the bytes (drawing a card that has scrolled into view, opening the
 * editor, writing an export) asks for them here first. In open mode nothing
 * was ever separated and this resolves without a round trip.
 *
 * Concurrent callers share one request: a card and the editor over it ask at
 * the same moment, and a note's attachments are the last thing worth fetching
 * twice.
 */
const imageLoads = new Map<string, Promise<string[]>>();

/**
 * The attachments of a note, fetched if a listing left them behind.
 *
 * `null` means the bytes could not be had, which is not the same as the note
 * having none. Callers that write an images array back (the editor's add and
 * remove handlers) or serialize one (either export) must not read a failure as
 * an empty note: doing so replaces every attachment it already had with
 * nothing. This follows the contract of the actions around it: the failure is
 * reported here and returned, never thrown.
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
    notes.value = notes.value.map((n) =>
      n.id === id ? { ...n, images, imageCount: images.length } : n,
    );
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

// The gap a fresh numbering leaves between two notes, so that a note dropped
// between them has room to take a number of its own rather than making
// everything after it move up. See `positionBetween`, which is what spends
// it. Date.now() in createNote is always larger than these spaced positions,
// so new notes consistently sort to the end of the manual-order list.
const POSITION_STEP = 1000;

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
    position: input.position ?? Date.now(),
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
 * it would not be. The server decides; this is the same rule asked first, so
 * a viewer ticking a box, or a recipient reaching for the trash, is told in a
 * sentence instead of in a failed request.
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

export async function updateNote(
  id: string,
  changes: NoteUpdate,
): Promise<boolean> {
  // Generated notes have readonly title/content but mutable metadata. Route
  // the allowed fields to the per-note override sidecar.
  if (id.startsWith("generated:")) {
    const {
      pinned,
      color,
      tags,
      archived,
      trashed,
      trashedAt,
      reminder,
      position,
    } = changes;
    updateAutoNoteOverride(id, {
      ...(pinned !== undefined && { pinned }),
      ...(color !== undefined && { color }),
      ...(tags !== undefined && { tags }),
      ...(archived !== undefined && { archived }),
      ...(trashed !== undefined && { trashed }),
      ...(trashedAt !== undefined && { trashedAt }),
      ...(reminder !== undefined && { reminder }),
      ...(position !== undefined && { position }),
    });
    return true;
  }
  const base = notes.value.find((n) => n.id === id) ?? null;
  const refusal = base ? refusalFor(base, changes) : null;
  if (refusal) {
    reportFailure(`Refused change to shared note ${id}:`, changes, refusal);
    return false;
  }
  // Shown now, sent next, reconciled when the answer comes. See
  // `pendingWrites.ts` for why the two halves are separate, and `receiveNote`
  // for what happens to the answer.
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
      // Lost the optimistic-concurrency race against a concurrent writer
      // (another tab / device of the same user). 3-way merge against the
      // server's current state and retry exactly once.
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
        );
        return false;
      }
    }
    // The write never landed, so neither does what it showed. The note goes
    // back to what storage last confirmed, with any newer local write of its
    // own still on top of it.
    pendingWrites.settle(id, changes);
    if (base) receiveNote(base);
    reportFailure(`Failed to update note ${id}:`, err, "error.saveFailed");
    return false;
  }
}

/**
 * How a card leaves the grid, one look per kind of going:
 *
 * - `discard`: trashed or deleted. It drops a little and shrinks away.
 * - `archive`: put away. It is lifted up and off the board.
 * - `restore`: undeleted or unarchived, from the trash or the archive, back
 *   among the notes. It swells slightly as it fades, rising to meet them.
 */
export type LeaveStyle = "discard" | "archive" | "restore";

/**
 * Notes whose cards are playing their exit animation, in the moment before a
 * trash, archive or restore takes them out of the grid, and how each is going.
 * Without it a card simply vanished and the column closed over the gap at
 * once, which read as the page glitching rather than as the note going
 * somewhere. NoteCard reads this to play `.note-leaving`.
 */
export const leavingNotes = signal<ReadonlyMap<string, LeaveStyle>>(new Map());

/** How long `.note-leaving` runs; see styles.css. */
const LEAVE_MS = 200;

/**
 * Runs `change` once the cards for `ids` have animated out. Waits only for
 * notes whose card is in the current view and would no longer be after
 * `becomes` is applied: a note archived from a search that also shows archived
 * notes stays put, and must not blink out and back. Not at all with animations
 * turned off, so a change nobody can see is not held up for one. If `change`
 * fails the flag still clears, and the card comes back rather than staying
 * invisible over a note that never went anywhere.
 */
async function afterLeaving<T>(
  ids: string[],
  style: LeaveStyle,
  becomes: Partial<Pick<Note, "archived" | "trashed">> | "gone",
  change: () => Promise<T>,
): Promise<T> {
  const shown = new Map(sortedNotes.peek().map((n) => [n.id, n]));
  const leaves = (id: string) => {
    const note = shown.get(id);
    if (!note) return false;
    return becomes === "gone" || !inViewLocation({ ...note, ...becomes });
  };
  const animated = animations.peek() ? ids.filter(leaves) : [];
  if (animated.length === 0) return await change();
  const flagged = new Map(leavingNotes.peek());
  for (const id of animated) flagged.set(id, style);
  leavingNotes.value = flagged;
  try {
    await new Promise((resolve) => setTimeout(resolve, LEAVE_MS));
    return await change();
  } finally {
    const next = new Map(leavingNotes.peek());
    for (const id of animated) next.delete(id);
    leavingNotes.value = next;
  }
}

export async function permanentlyDeleteNote(id: string): Promise<boolean> {
  return await afterLeaving([id], "discard", "gone", () => deleteNow(id));
}

async function deleteNow(id: string): Promise<boolean> {
  // "Permanent delete" on an auto-note clears the override; the note will
  // reappear on the next render in its default state. (The plugin still owns
  // the source of truth; deletion is never truly permanent for auto-notes.)
  if (id.startsWith("generated:")) {
    clearAutoNoteOverride(id);
    return true;
  }
  // Out of the grid now, as with every other write; back into it if the
  // delete never landed. A selection of twenty otherwise emptied one card at
  // a time, over as many round trips.
  const held = notes.value.find((n) => n.id === id) ?? null;
  notes.value = notes.value.filter((n) => n.id !== id);
  try {
    await storage.delete(id);
    deleteVersions(id);
    return true;
  } catch (err) {
    if (held) notes.value = upsertById(notes.value, held);
    reportFailure(`Failed to delete note ${id}:`, err, "error.deleteFailed");
    return false;
  }
}

export async function deleteAllNotes(): Promise<boolean> {
  try {
    await storage.deleteAll();
    // Re-read instead of assuming []. RestApiAdapter deletes one-by-one and a
    // partial failure (caught above) would otherwise leave the signal lying.
    notes.value = await storage.getAll();
    return true;
  } catch (err) {
    reportFailure("Failed to delete all notes:", err, "error.deleteFailed");
    notes.value = await storage.getAll().catch(() => notes.value);
    return false;
  }
}

const TRASHED = { trashed: true, archived: false } as const;
const RESTORED = { trashed: false } as const;
const ARCHIVED = { archived: true } as const;
const UNARCHIVED = { archived: false } as const;

export async function trashNote(id: string): Promise<boolean> {
  return await afterLeaving([id], "discard", TRASHED, () => trashNow(id));
}

async function trashNow(id: string): Promise<boolean> {
  return await updateNote(id, {
    trashed: true,
    trashedAt: new Date().toISOString(),
    archived: false,
  });
}

export async function restoreNote(id: string): Promise<boolean> {
  return await afterLeaving([id], "restore", RESTORED, () => restoreNow(id));
}

async function restoreNow(id: string): Promise<boolean> {
  return await updateNote(id, { trashed: false, trashedAt: null });
}

export async function archiveNote(id: string): Promise<boolean> {
  return await afterLeaving([id], "archive", ARCHIVED, () => archiveNow(id));
}

async function archiveNow(id: string): Promise<boolean> {
  return await updateNote(id, ARCHIVED);
}

export async function unarchiveNote(id: string): Promise<boolean> {
  return await afterLeaving([id], "restore", UNARCHIVED, () =>
    unarchiveNow(id),
  );
}

async function unarchiveNow(id: string): Promise<boolean> {
  return await updateNote(id, UNARCHIVED);
}

/**
 * The note most recently pinned or unpinned, for the brief moment after the
 * toggle. Pinning moves a card between the pinned and unpinned grids, which
 * unmounts and remounts it; otherwise it simply teleports. NoteCard reads
 * this on mount to play a short settle animation instead.
 */
export const recentlyPinned = signal<string | null>(null);

let pinSettleTimer: ReturnType<typeof setTimeout> | undefined;

export async function togglePin(id: string) {
  const note = allNotes.value.find((n) => n.id === id);
  if (!note) return;
  recentlyPinned.value = id;
  clearTimeout(pinSettleTimer);
  pinSettleTimer = setTimeout(() => {
    recentlyPinned.value = null;
  }, 500);
  await updateNote(id, { pinned: !note.pinned });
}

/**
 * Adds one tag to one note, reading its tags as they stand now rather than as
 * the caller last rendered them: the tag picker stays open between adds, and
 * two picked before a render would otherwise each write a list holding only
 * itself. Takes `allNotes` so an auto-note's override gets it too.
 */
export async function addTag(id: string, tag: string): Promise<boolean> {
  const note = allNotes.peek().find((n) => n.id === id);
  if (!note) return false;
  if (note.tags.includes(tag)) return true;
  return await updateNote(id, { tags: [...note.tags, tag] });
}

export async function deleteTag(tag: string): Promise<boolean> {
  const affectedIds = notes.value
    .filter((n) => n.tags.includes(tag))
    .map((n) => n.id);
  const ok = await asBatch(async () => {
    await Promise.all(
      affectedIds.map((id) => {
        const note = notes.value.find((n) => n.id === id);
        if (!note) return Promise.resolve(false);
        return updateNote(id, { tags: note.tags.filter((t) => t !== tag) });
      }),
    );
  });
  if (activeTag.value === tag) {
    activeTag.value = null;
  }
  return ok;
}

export async function addTagToNotes(
  tag: string,
  noteIds: Set<string>,
): Promise<boolean> {
  return await asBatch(async () => {
    await Promise.all(
      [...noteIds].map((id) => {
        const note = notes.value.find((n) => n.id === id);
        if (!note || note.tags.includes(tag)) return Promise.resolve(true);
        return updateNote(id, { tags: [...note.tags, tag] });
      }),
    );
  });
}

// --- Selection ---

export function enterSelectMode(noteId?: string) {
  selectMode.value = true;
  selectedNotes.value = noteId ? new Set([noteId]) : new Set();
}

export function exitSelectMode() {
  selectMode.value = false;
  selectedNotes.value = new Set();
}

export function selectAllVisible() {
  const ids = sortedNotes.value.filter((n) => !n.readonly).map((n) => n.id);
  const current = selectedNotes.value;
  const allSelected = ids.length > 0 && ids.every((id) => current.has(id));
  if (allSelected) {
    const next = new Set(current);
    for (const id of ids) next.delete(id);
    selectedNotes.value = next;
    if (next.size === 0) selectMode.value = false;
  } else {
    const next = new Set(current);
    for (const id of ids) next.add(id);
    selectedNotes.value = next;
    if (next.size > 0) selectMode.value = true;
  }
}

export function toggleSelectNote(id: string) {
  const next = new Set(selectedNotes.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedNotes.value = next;
  if (next.size === 0) {
    selectMode.value = false;
  }
}

/**
 * Applies `act` to every selected note that still exists, as one operation.
 *
 * Started together rather than one after the next. Each write shows its own
 * change before it awaits anything, so starting them in the same tick settles
 * the board once; awaiting each in turn walked the selection a round trip at
 * a time, with the grid closing over one card and then the next for as long
 * as the selection was large.
 */
async function bulkApply(
  act: (id: string) => Promise<unknown>,
): Promise<boolean> {
  const ids = [...selectedNotes.value].filter((id) =>
    notes.value.some((n) => n.id === id),
  );
  const ok = await asBatch(async () => {
    await Promise.all(ids.map((id) => act(id)));
  });
  exitSelectMode();
  return ok;
}

export async function bulkPin(): Promise<boolean> {
  const allPinned = [...selectedNotes.value].every(
    (id) => notes.value.find((n) => n.id === id)?.pinned,
  );
  return await bulkApply((id) => updateNote(id, { pinned: !allPinned }));
}

// One exit for the whole selection: going through `archiveNote` or
// `trashNote` per note would animate the cards out one after another, a fifth
// of a second apiece.
export async function bulkArchive(): Promise<boolean> {
  return await afterLeaving([...selectedNotes.value], "archive", ARCHIVED, () =>
    bulkApply(archiveNow),
  );
}

export async function bulkTrash(): Promise<boolean> {
  return await afterLeaving([...selectedNotes.value], "discard", TRASHED, () =>
    bulkApply(trashNow),
  );
}

export async function bulkDelete(): Promise<boolean> {
  return await afterLeaving([...selectedNotes.value], "discard", "gone", () =>
    bulkApply(deleteNow),
  );
}

export async function bulkRestore(): Promise<boolean> {
  return await afterLeaving([...selectedNotes.value], "restore", RESTORED, () =>
    bulkApply(restoreNow),
  );
}

export async function bulkSetColor(color: NoteColor): Promise<boolean> {
  return await bulkApply((id) => updateNote(id, { color }));
}

export async function bulkAddTag(tag: string): Promise<boolean> {
  const ok = await addTagToNotes(tag, selectedNotes.value);
  exitSelectMode();
  return ok;
}

/**
 * Where a note dropped between two others belongs: halfway between them.
 *
 * `position` is a float in both storage drivers (`REAL` in SQLite,
 * `DOUBLE PRECISION` in Postgres), which is what makes this available at all.
 * A gap of {@link POSITION_STEP} survives about fifty successive halvings
 * before two doubles have nothing left between them, so a drop writes the one
 * note that moved and {@link renumberFrom} is a fallback that in practice
 * never runs. This is the pattern the spacing was always for.
 *
 * Null when the two have no room between them, which is the caller's cue to
 * spread everything out again. That covers a gap halved away to nothing and a
 * pair that are equal or out of order, which tied data can produce.
 */
function positionBetween(
  before: number | undefined,
  after: number | undefined,
): number | null {
  if (before === undefined) {
    return after === undefined ? null : after - POSITION_STEP;
  }
  if (after === undefined) return before + POSITION_STEP;
  const between = (before + after) / 2;
  if (between <= before || between >= after) return null;
  return between;
}

/**
 * Spread every note out again, with the dropped one at `at`.
 *
 * Over the whole number line rather than the section that was dragged, so the
 * notes not on screen keep their place among the ones that are. Reached only
 * when {@link positionBetween} has run out of room.
 */
async function renumberFrom(
  rest: Note[],
  at: number,
  movedId: string,
): Promise<void> {
  const order = rest.map((n) => n.id);
  order.splice(at, 0, movedId);
  await asBatch(async () => {
    await Promise.all(
      order.map((id, i) =>
        updateNote(id, { position: (i + 1) * POSITION_STEP }),
      ),
    );
  });
}

/**
 * Moves one note within `noteIds`, the dragged section's order as it stood
 * before the drop.
 *
 * The note lands immediately after the one it was dropped behind, on the
 * whole number line and not just within the section. Archived and trashed
 * notes are off screen but share that line, so the slot is found among them
 * too: a midpoint taken between the visible neighbours alone can land on a
 * hidden note's exact position, and renumbering the visible ones, which is
 * what this used to do, rewrote them into a range a hidden note's old number
 * already sat inside. That is how restoring a note from the archive came to
 * land it at the top of the board. Writing one number and leaving every other
 * one alone cannot do either.
 */
export async function reorderNotes(
  noteIds: string[],
  fromIndex: number,
  toIndex: number,
) {
  if (fromIndex === toIndex) return;
  const movedId = noteIds[fromIndex];
  if (movedId === undefined) return;
  const section = [...noteIds];
  section.splice(fromIndex, 1);
  section.splice(toIndex, 0, movedId);
  const predecessorId = section[toIndex - 1];

  const rest = [...allNotes.peek()]
    .sort(byPosition)
    .filter((n) => n.id !== movedId);
  // Straight after the note it was dropped behind, or at the head when it was
  // dropped in front of everything. A predecessor that is somehow not on the
  // line puts it at the head too, which is at least somewhere.
  const at =
    predecessorId === undefined
      ? 0
      : rest.findIndex((n) => n.id === predecessorId) + 1;

  const next = positionBetween(rest[at - 1]?.position, rest[at]?.position);
  if (next === null) {
    await renumberFrom(rest, at, movedId);
    return;
  }
  await updateNote(movedId, { position: next });
}

/** As `noteHasChecklist`, but only counting boxes that are ticked. */
export function hasCheckedItems(content: string): boolean {
  const lines = content.split("\n");
  const fenced = markFencedLines(lines);
  return lines.some(
    (line, i) => !fenced[i] && parseChecklistLine(line)?.checked === true,
  );
}

export async function deleteCheckedItems(id: string) {
  const note = notes.value.find((n) => n.id === id);
  if (!note) return;
  const next = removeCheckedItems(note.content);
  if (next === note.content) return;
  await updateNote(id, { content: next });
}

export async function toggleCheckbox(id: string, lineIndex: number) {
  const note = notes.value.find((n) => n.id === id);
  if (!note) return;
  const lines = note.content.split("\n");
  const fenced = markFencedLines(lines);
  if (fenced[lineIndex]) return;
  const item = parseChecklistLine(lines[lineIndex]);
  if (!item) return;
  const next = !item.checked;
  lines[lineIndex] = setChecklistChecked(lines[lineIndex], next);

  // Cascade to descendants: subsequent contiguous checkbox lines with
  // greater indent. Matches the editor's subtree toggle behavior, and stops at
  // a fence for the same reason the deletion sweep does.
  const parentIndent = item.indent.length;
  for (let i = lineIndex + 1; i < lines.length; i++) {
    if (fenced[i]) break;
    const child = parseChecklistLine(lines[i]);
    if (!child) break;
    if (child.indent.length <= parentIndent) break;
    lines[i] = setChecklistChecked(lines[i], next);
  }

  await updateNote(id, { content: lines.join("\n") });
}

/**
 * How many attachment fetches an export has in flight at once.
 *
 * A backup of four hundred notes is four hundred `GET /api/notes/:id` calls,
 * and firing them together trips the server's per-user rate limit, which
 * comes back as failures, which is precisely the lossy backup this is here to
 * prevent. Draining a few at a time is slower and finishes.
 */
const EXPORT_IMAGE_CONCURRENCY = 6;

/**
 * Every note as JSON, attachments included, or `null` if they could not all
 * be gathered.
 *
 * A server listing leaves the bytes behind, so the notes in the signal carry
 * `imageCount` and an empty `images` until something asks for them. Writing
 * the file straight from the signal produced a backup that looked complete and
 * silently held no pictures at all, and importing it back deleted them for
 * good. So the missing ones are fetched first, and if any of them cannot be,
 * this refuses rather than handing back a file the user would trust.
 */
export async function exportNotes(): Promise<string | null> {
  const missing = notes.value.filter(hasUnloadedImages).map((n) => n.id);
  for (let i = 0; i < missing.length; i += EXPORT_IMAGE_CONCURRENCY) {
    await Promise.all(
      missing
        .slice(i, i + EXPORT_IMAGE_CONCURRENCY)
        .map((id) => ensureImages(id)),
    );
  }
  // `ensureImages` has already said what went wrong; this only decides that a
  // partial backup is not worth writing. Re-reading the signal rather than
  // trusting the return values also covers a note that arrived mid-export.
  if (notes.value.some(hasUnloadedImages)) {
    showError(t("error.exportFailed"));
    return null;
  }
  // Who else holds a note is the server's to say, and would mean nothing in
  // a file imported somewhere else.
  const plain = notes.value.map(({ sharing: _sharing, ...note }) => note);
  return JSON.stringify(plain, null, 2);
}

export async function importNotes(imported: Note[]): Promise<boolean> {
  try {
    await storage.importAll(imported);
    notes.value = await storage.getAll();
    return true;
  } catch (err) {
    reportFailure("Failed to import notes:", err, "error.importFailed");
    return false;
  }
}

export async function expireTrash() {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const expired = notes.value.filter(
    (n) =>
      n.trashed &&
      n.trashedAt &&
      new Date(n.trashedAt).getTime() < thirtyDaysAgo,
  );
  for (const note of expired) {
    await permanentlyDeleteNote(note.id);
  }
}
