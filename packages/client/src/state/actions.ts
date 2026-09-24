import type { Note, NoteColor } from "@manifesto/shared";
import { signal } from "@preact/signals";
import { removeCheckedItems, toggleChecklistItem } from "../utils/markdown.js";
import { asBatch, type Batch } from "./failures.js";
import { allNotes, deleteNote, notes, updateNote } from "./notesStore.js";
import {
  byPosition,
  headPositions,
  POSITION_STEP,
  positionBetween,
} from "./ordering.js";
import { animations, hiddenTags } from "./prefs.js";
import { exitSelectMode } from "./selection.js";
import { activeTag, selectedNotes } from "./ui.js";
import { inViewLocation, setTagHidden, sortedNotes } from "./views.js";

/**
 * The user-level note actions: each one a thing a button does, built on the
 * store's `updateNote` / `deleteNote`. Like those, every action reports its
 * own failure and resolves; see `failures.ts`.
 */

/**
 * How a card leaves the grid, one look per kind of going:
 *
 * - `discard`: trashed or deleted. It drops a little and shrinks away.
 * - `archive`: put away. It is lifted up and off the board.
 * - `restore`: back among the notes from the trash or the archive. It swells
 *   slightly as it fades, rising to meet them.
 */
export type LeaveStyle = "discard" | "archive" | "restore";

/**
 * Notes whose cards are playing their exit animation, in the moment before a
 * trash, archive or restore takes them out of the grid, and how each is going.
 * NoteCard reads this to play `.note-leaving`.
 */
export const leavingNotes = signal<ReadonlyMap<string, LeaveStyle>>(new Map());

/** How long `.note-leaving` runs; see styles.css. */
const LEAVE_MS = 200;

/**
 * Runs `change` once the cards for `ids` have animated out. Waits only for
 * notes whose card is in the current view and would no longer be after
 * `becomes` is applied, and not at all with animations off. If `change`
 * fails the flag still clears, so the card comes back rather than staying
 * invisible.
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

const TRASHED = { trashed: true, archived: false } as const;
const RESTORED = { trashed: false } as const;
const ARCHIVED = { archived: true } as const;
const UNARCHIVED = { archived: false } as const;

function trashNow(id: string, batch?: Batch): Promise<boolean> {
  return updateNote(
    id,
    { ...TRASHED, trashedAt: new Date().toISOString() },
    batch,
  );
}

function restoreNow(id: string, batch?: Batch): Promise<boolean> {
  return updateNote(id, { ...RESTORED, trashedAt: null }, batch);
}

function archiveNow(id: string, batch?: Batch): Promise<boolean> {
  return updateNote(id, ARCHIVED, batch);
}

function unarchiveNow(id: string, batch?: Batch): Promise<boolean> {
  return updateNote(id, UNARCHIVED, batch);
}

export async function permanentlyDeleteNote(id: string): Promise<boolean> {
  return await afterLeaving([id], "discard", "gone", () => deleteNote(id));
}

export async function trashNote(id: string): Promise<boolean> {
  return await afterLeaving([id], "discard", TRASHED, () => trashNow(id));
}

export async function restoreNote(id: string): Promise<boolean> {
  return await afterLeaving([id], "restore", RESTORED, () => restoreNow(id));
}

export async function archiveNote(id: string): Promise<boolean> {
  return await afterLeaving([id], "archive", ARCHIVED, () => archiveNow(id));
}

export async function unarchiveNote(id: string): Promise<boolean> {
  return await afterLeaving([id], "restore", UNARCHIVED, () =>
    unarchiveNow(id),
  );
}

/**
 * The note most recently pinned or unpinned, for the brief moment after the
 * toggle. Pinning moves a card between the pinned and unpinned grids, which
 * remounts it; NoteCard reads this on mount to play a settle animation.
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
  await updateNote(
    id,
    note.pinned
      ? { pinned: false }
      : { pinned: true, position: headPositions(notes.peek(), 1)[0] },
  );
}

// --- Tags ---

/**
 * Adds one tag to one note, reading its tags as they stand now rather than as
 * the caller last rendered them: two tags picked before a render would
 * otherwise each write a list holding only itself. Reads `allNotes` so an
 * auto-note's override gets it too.
 */
export async function addTag(id: string, tag: string): Promise<boolean> {
  const note = allNotes.peek().find((n) => n.id === id);
  if (!note) return false;
  if (note.tags.includes(tag)) return true;
  return await updateNote(id, { tags: [...note.tags, tag] });
}

/** Rewrites the tags of every note carrying `tag`, as one operation. */
function retagNotesWith(
  tag: string,
  retag: (tags: string[]) => string[],
): Promise<boolean> {
  const affected = notes.peek().filter((n) => n.tags.includes(tag));
  return asBatch((batch) =>
    Promise.all(
      affected.map(({ id }) => {
        // Read at write time, not when the list was taken.
        const note = notes.peek().find((n) => n.id === id);
        if (!note) return false;
        return updateNote(id, { tags: retag(note.tags) }, batch);
      }),
    ),
  );
}

export async function deleteTag(tag: string): Promise<boolean> {
  const ok = await retagNotesWith(tag, (tags) => tags.filter((t) => t !== tag));
  if (activeTag.value === tag) {
    activeTag.value = null;
  }
  // A tag gone from every note should not hide the next note given it.
  if (ok) setTagHidden(tag, false);
  return ok;
}

/**
 * Gives every note tagged `from` the tag `to` in its place. A note that has
 * both already just loses `from`, so the rename can also merge two tags.
 * `to` is expected normalized the way the tag picker does it.
 */
export async function renameTag(from: string, to: string): Promise<boolean> {
  if (from === to) return true;
  const ok = await retagNotesWith(from, (tags) =>
    tags.includes(to)
      ? tags.filter((t) => t !== from)
      : tags.map((t) => (t === from ? to : t)),
  );
  if (activeTag.value === from) {
    activeTag.value = to;
  }
  // Hidden under its old name stays hidden under its new one.
  if (ok && hiddenTags.value.includes(from)) {
    setTagHidden(from, false);
    setTagHidden(to, true);
  }
  return ok;
}

export async function addTagToNotes(
  tag: string,
  noteIds: Set<string>,
): Promise<boolean> {
  return await asBatch((batch) =>
    Promise.all(
      [...noteIds].map((id) => {
        const note = notes.peek().find((n) => n.id === id);
        if (!note || note.tags.includes(tag)) return true;
        return updateNote(id, { tags: [...note.tags, tag] }, batch);
      }),
    ),
  );
}

// --- Bulk ---

/**
 * Applies `act` to every selected note that still exists, as one operation,
 * then leaves select mode. The writes start together: each shows its change
 * before it awaits anything, so the board settles once.
 */
async function bulkApply(
  act: (id: string, batch: Batch) => Promise<unknown>,
): Promise<boolean> {
  const held = notes.peek();
  const ids = [...selectedNotes.value].filter((id) =>
    held.some((n) => n.id === id),
  );
  const ok = await asBatch((batch) =>
    Promise.all(ids.map((id) => act(id, batch))),
  );
  exitSelectMode();
  return ok;
}

export async function bulkPin(): Promise<boolean> {
  const allPinned = [...selectedNotes.value].every(
    (id) => notes.value.find((n) => n.id === id)?.pinned,
  );
  if (allPinned) {
    return await bulkApply((id, batch) =>
      updateNote(id, { pinned: false }, batch),
    );
  }
  // To the head of the pinned section together, in the order they had.
  const ordered = notes
    .peek()
    .filter((n) => selectedNotes.value.has(n.id))
    .sort(byPosition);
  const heads = headPositions(notes.peek(), ordered.length);
  const at = new Map(ordered.map((n, i) => [n.id, heads[i]]));
  return await bulkApply((id, batch) =>
    updateNote(id, { pinned: true, position: at.get(id) }, batch),
  );
}

// One exit for the whole selection: going through `archiveNote` or
// `trashNote` per note would animate the cards out one after another.
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
    bulkApply(deleteNote),
  );
}

export async function bulkRestore(): Promise<boolean> {
  return await afterLeaving([...selectedNotes.value], "restore", RESTORED, () =>
    bulkApply(restoreNow),
  );
}

export async function bulkSetColor(color: NoteColor): Promise<boolean> {
  return await bulkApply((id, batch) => updateNote(id, { color }, batch));
}

export async function bulkAddTag(tag: string): Promise<boolean> {
  const ok = await addTagToNotes(tag, selectedNotes.value);
  exitSelectMode();
  return ok;
}

// --- Order ---

/**
 * Spread every note out again, with the moved one at `at`. Over the whole
 * number line rather than the dragged section, so notes not on screen keep
 * their place. Reached only when `positionBetween` has run out of room.
 */
async function renumberFrom(
  rest: Note[],
  at: number,
  movedId: string,
): Promise<void> {
  const order = rest.map((n) => n.id);
  order.splice(at, 0, movedId);
  await asBatch((batch) =>
    Promise.all(
      order.map((id, i) =>
        updateNote(id, { position: (i + 1) * POSITION_STEP }, batch),
      ),
    ),
  );
}

/**
 * Moves one note within `noteIds`, the dragged section's order as it stood
 * before the drop. The note lands straight after the one it was dropped
 * behind, on the whole number line: archived and trashed notes are off screen
 * but share it, so a midpoint between the visible neighbours alone could land
 * on a hidden note's position. Only the moved note is written.
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
  // A predecessor that is somehow not on the line puts it at the head.
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

// --- Checklists ---

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
  const next = toggleChecklistItem(note.content, lineIndex);
  if (next === null) return;
  await updateNote(id, { content: next });
}
