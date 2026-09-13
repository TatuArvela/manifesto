import type { Note, NoteCreate, NoteUpdate } from "@manifesto/shared";
import {
  hasUnloadedImages,
  imageCountOf,
  NoteColor,
  NoteFont,
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
import { mergeNoteUpdate } from "./mergeNote.js";
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

export const filteredNotes = computed(() => {
  let result: Note[] = allNotes.value;

  // Filter by view
  switch (activeView.value) {
    case "active":
      result = result.filter((n) => !n.archived && !n.trashed);
      break;
    case "tags":
      result = result.filter((n) => {
        if (n.trashed) return tagsShowTrashed.value;
        if (n.archived) return tagsShowArchived.value;
        return tagsShowActive.value;
      });
      if (activeTag.value) {
        const tag = activeTag.value;
        result = result.filter((n) => n.tags.includes(tag));
      }
      break;
    case "reminders":
      result = result.filter((n) => n.reminder && !n.trashed);
      break;
    case "autoNotes":
      result = result.filter((n) => n.readonly && !n.archived && !n.trashed);
      break;
    case "archived":
      result = result.filter((n) => n.archived && !n.trashed);
      break;
    case "trash":
      result = result.filter((n) => n.trashed);
      break;
    case "search": {
      const types = searchTypes.value;
      const colors = searchColors.value;
      if (!searchQuery.value && types.size === 0 && colors.size === 0) {
        result = [];
        break;
      }
      const locations = searchLocations.value;
      result = result.filter((n) => {
        if (n.trashed) return locations.has("trashed");
        if (n.archived) return locations.has("archived");
        return locations.has("active");
      });
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

export const sortedNotes = computed(() => {
  const result = [...filteredNotes.value];
  if (activeView.value === "reminders") {
    result.sort((a, b) =>
      (a.reminder?.time ?? "").localeCompare(b.reminder?.time ?? ""),
    );
    return result;
  }
  if (activeView.value === "trash") {
    result.sort(
      (a, b) =>
        new Date(b.trashedAt ?? 0).getTime() -
        new Date(a.trashedAt ?? 0).getTime(),
    );
    return result;
  }
  switch (sortMode.value) {
    case "updated":
      result.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      break;
    case "created":
      result.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      break;
    default:
      result.sort((a, b) => a.position - b.position);
      break;
  }
  return result;
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
    notes.value = await storage.getAll();
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

// Reorder writes spaced positions so a future tweak (insert-between, etc.)
// doesn't have to renumber the whole list. Date.now() in createNote is always
// larger than these spaced positions, so new notes consistently sort to the
// end of the manual-order list, same as the pre-reorder behavior.
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
    notes.value = upsertById(notes.value, note);
    return note;
  } catch (err) {
    reportFailure("Failed to create note:", err, "error.createFailed");
    return null;
  }
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
  try {
    const note = await storage.update(
      id,
      changes,
      base ? { ifMatch: base.updatedAt } : undefined,
    );
    notes.value = notes.value.map((n) => (n.id === id ? note : n));
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
        notes.value = notes.value.map((n) => (n.id === id ? note : n));
        return true;
      } catch (retryErr) {
        reportFailure(
          `Conflict retry failed for note ${id}:`,
          retryErr,
          "error.saveFailed",
        );
        return false;
      }
    }
    reportFailure(`Failed to update note ${id}:`, err, "error.saveFailed");
    return false;
  }
}

/**
 * Notes whose cards are playing their exit animation, in the moment before a
 * trash or delete takes them out of the grid. Without it a card simply
 * vanished and the column closed over the gap at once, which read as the page
 * glitching rather than as the note being thrown away. NoteCard reads this to
 * play `.note-leaving`.
 */
export const leavingNotes = signal<ReadonlySet<string>>(new Set());

/** How long `.note-leaving` runs; see styles.css. */
const LEAVE_MS = 200;

/**
 * Runs `remove` once the cards for `ids` have animated out. Waits only for
 * notes that have a card in the current view, and not at all with animations
 * turned off, so a delete nobody can see is not held up for one. If `remove`
 * fails the flag still clears, and the card comes back rather than staying
 * invisible over a note that was never removed.
 */
async function afterLeaving<T>(
  ids: string[],
  remove: () => Promise<T>,
): Promise<T> {
  const shown = new Set(sortedNotes.peek().map((n) => n.id));
  const animated = animations.peek() ? ids.filter((id) => shown.has(id)) : [];
  if (animated.length === 0) return await remove();
  leavingNotes.value = new Set([...leavingNotes.peek(), ...animated]);
  try {
    await new Promise((resolve) => setTimeout(resolve, LEAVE_MS));
    return await remove();
  } finally {
    const next = new Set(leavingNotes.peek());
    for (const id of animated) next.delete(id);
    leavingNotes.value = next;
  }
}

export async function permanentlyDeleteNote(id: string): Promise<boolean> {
  return await afterLeaving([id], () => deleteNow(id));
}

async function deleteNow(id: string): Promise<boolean> {
  // "Permanent delete" on an auto-note clears the override; the note will
  // reappear on the next render in its default state. (The plugin still owns
  // the source of truth; deletion is never truly permanent for auto-notes.)
  if (id.startsWith("generated:")) {
    clearAutoNoteOverride(id);
    return true;
  }
  try {
    await storage.delete(id);
    notes.value = notes.value.filter((n) => n.id !== id);
    deleteVersions(id);
    return true;
  } catch (err) {
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

export async function trashNote(id: string): Promise<boolean> {
  return await afterLeaving([id], () => trashNow(id));
}

async function trashNow(id: string): Promise<boolean> {
  return await updateNote(id, {
    trashed: true,
    trashedAt: new Date().toISOString(),
    archived: false,
  });
}

export async function restoreNote(id: string): Promise<boolean> {
  return await updateNote(id, { trashed: false, trashedAt: null });
}

export async function archiveNote(id: string): Promise<boolean> {
  return await updateNote(id, { archived: true });
}

export async function unarchiveNote(id: string): Promise<boolean> {
  return await updateNote(id, { archived: false });
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

export async function deleteTag(tag: string): Promise<boolean> {
  const affectedIds = notes.value
    .filter((n) => n.tags.includes(tag))
    .map((n) => n.id);
  const ok = await asBatch(async () => {
    for (const id of affectedIds) {
      const note = notes.value.find((n) => n.id === id);
      if (note) {
        await updateNote(id, { tags: note.tags.filter((t) => t !== tag) });
      }
    }
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
    for (const id of noteIds) {
      const note = notes.value.find((n) => n.id === id);
      if (note && !note.tags.includes(tag)) {
        await updateNote(id, { tags: [...note.tags, tag] });
      }
    }
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

/** Applies `act` to every selected note that still exists, as one operation. */
async function bulkApply(
  act: (id: string) => Promise<unknown>,
): Promise<boolean> {
  const ids = [...selectedNotes.value];
  const ok = await asBatch(async () => {
    for (const id of ids) {
      if (notes.value.some((n) => n.id === id)) await act(id);
    }
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

export async function bulkArchive(): Promise<boolean> {
  return await bulkApply(archiveNote);
}

// One exit for the whole selection: going through `trashNote` per note would
// animate the cards out one after another, a fifth of a second apiece.
export async function bulkTrash(): Promise<boolean> {
  return await afterLeaving([...selectedNotes.value], () =>
    bulkApply(trashNow),
  );
}

export async function bulkDelete(): Promise<boolean> {
  return await afterLeaving([...selectedNotes.value], () =>
    bulkApply(deleteNow),
  );
}

export async function bulkRestore(): Promise<boolean> {
  return await bulkApply(restoreNote);
}

export async function bulkSetColor(color: NoteColor): Promise<boolean> {
  return await bulkApply((id) => updateNote(id, { color }));
}

export async function bulkAddTag(tag: string): Promise<boolean> {
  const ok = await addTagToNotes(tag, selectedNotes.value);
  exitSelectMode();
  return ok;
}

export async function reorderNotes(
  noteIds: string[],
  fromIndex: number,
  toIndex: number,
) {
  if (fromIndex === toIndex) return;
  const reordered = [...noteIds];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  // Spaced rather than 0..n-1 so a future insert-between doesn't have to
  // renumber the list. See POSITION_STEP for why the spacing stays clear of
  // the `Date.now()` a new note gets.
  await asBatch(async () => {
    for (let i = 0; i < reordered.length; i++) {
      await updateNote(reordered[i], { position: (i + 1) * POSITION_STEP });
    }
  });
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
  return JSON.stringify(notes.value, null, 2);
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
