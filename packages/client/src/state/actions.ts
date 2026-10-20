import {
  imageAltsOf,
  isTagWithin,
  type Note,
  type NoteColor,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { sortChecklistByDate } from "#/utils/itemDate.ts";
import {
  moveCheckedLast,
  removeCheckedItems,
  toggleChecklistItem,
  uncheckAllItems,
} from "#/utils/markdown.ts";
import { asBatch, type Batch } from "./failures.ts";
import {
  allNotes,
  deleteNote,
  ensureImages,
  notes,
  updateNote,
} from "./notesStore.ts";
import {
  byPosition,
  headPosition,
  headPositions,
  POSITION_STEP,
  positionBetween,
} from "./ordering.ts";
import {
  animations,
  checkedItemsLast,
  hiddenTags,
  tagColors,
} from "./prefs.ts";
import { exitSelectMode } from "./selection.ts";
import { activeTag, selectedNotes } from "./ui.ts";
import {
  canReorder,
  inViewLocation,
  pinnedNotes,
  setTagColor,
  setTagHidden,
  sortedNotes,
  unpinnedNotes,
} from "./views.ts";

/**
 * The note actions at user level, each what a button does, built on the
 * `updateNote` / `deleteNote` of the store. As those do, each action reports
 * its own failure and resolves. See `failures.ts`.
 */

/**
 * How a card goes out of the grid, one look for each kind of departure:
 *
 * - `discard`: trashed or deleted. It becomes smaller to its centre and goes.
 * - `archive`: put away. It is lifted up and off the board.
 * - `undelete`: back among the notes from the trash. It ascends: it glows, and
 *   floats up out of the Trash into the light.
 * - `restore`: back among the notes from the archive. It becomes a little
 *   larger while it fades, and rises to meet them.
 */
export type LeaveStyle = "discard" | "archive" | "undelete" | "restore";

/**
 * Notes whose cards play their exit animation, in the moment before a trash,
 * archive or restore takes them out of the grid, and how each goes. NoteCard
 * reads this to play `.note-leaving`.
 */
export const leavingNotes = signal<ReadonlyMap<string, LeaveStyle>>(new Map());

/** How long `.note-leaving` runs for each, as `note-cards.css` has it. */
const LEAVE_MS: Record<LeaveStyle, number> = {
  discard: 250,
  archive: 200,
  undelete: 600,
  restore: 200,
};

/**
 * Runs `change` one time after the cards for `ids` animated out. It waits only
 * for notes whose card is in the current view and would not be there after
 * `becomes` applies. It does not wait with animations off. If `change` fails,
 * the flag still clears. Thus, the card comes back, and does not stay
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
    await new Promise((resolve) => setTimeout(resolve, LEAVE_MS[style]));
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
  return await afterLeaving([id], "undelete", RESTORED, () => restoreNow(id));
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
 * The note pinned or unpinned most recently, for the short moment after the
 * toggle. A pin moves a card between the pinned and unpinned grids, which
 * mounts it again. NoteCard reads this on mount to play a settle animation.
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
      : { pinned: true, position: headPosition(notes.peek()) },
  );
}

// --- Tags ---

/**
 * Adds one tag to one note. It reads the current tags, not the tags that the
 * caller last rendered. If not, two tags selected before a render would each
 * write a list that contains only itself. Reads `allNotes`. Thus, the override
 * of an auto-note also gets it.
 */
export async function addTag(id: string, tag: string): Promise<boolean> {
  const note = allNotes.peek().find((n) => n.id === id);
  if (!note) return false;
  if (note.tags.includes(tag)) return true;
  return await updateNote(id, { tags: [...note.tags, tag] });
}

/**
 * Writes again the tags of each note that has `tag` or a tag under it, as one
 * operation.
 */
function retagNotesWith(
  tag: string,
  retag: (tags: string[]) => string[],
): Promise<boolean> {
  const under = (n: Note) => n.tags.some((t) => isTagWithin(t, tag));
  const affected = notes.peek().filter(under);
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

/** The tags, among `known`, that are `tag` or under it. */
function withinTag(known: string[], tag: string): string[] {
  return known.filter((t) => isTagWithin(t, tag));
}

/**
 * Removes a tag from each note, and with it each tag under it. A deletion of
 * `work` also deletes `work/clients`, as a deletion of a folder would.
 */
export async function deleteTag(tag: string): Promise<boolean> {
  const ok = await retagNotesWith(tag, (tags) =>
    tags.filter((t) => !isTagWithin(t, tag)),
  );
  if (activeTag.value !== null && isTagWithin(activeTag.value, tag)) {
    activeTag.value = null;
  }
  // A tag that is gone from each note must not hide the next note that gets it,
  // or give it a color.
  if (ok) {
    for (const t of withinTag(hiddenTags.value, tag)) setTagHidden(t, false);
    for (const t of withinTag(Object.keys(tagColors.value), tag)) {
      setTagColor(t, null);
    }
  }
  return ok;
}

/**
 * Gives each note tagged `from` the tag `to` in its place, and moves the tags
 * under `from` with it (`work/clients` becomes `job/clients`). A note that
 * already has both only loses `from`. Thus, the rename can also merge two tags.
 * The caller must give `to` normalized, as the tag picker does.
 */
export async function renameTag(from: string, to: string): Promise<boolean> {
  if (from === to) return true;
  const moved = (tag: string) =>
    isTagWithin(tag, from) ? to + tag.slice(from.length) : tag;
  const ok = await retagNotesWith(from, (tags) => [
    ...new Set(tags.map(moved)),
  ]);
  if (activeTag.value !== null) activeTag.value = moved(activeTag.value);
  if (!ok) return ok;
  // A tag hidden under its old name stays hidden under its new name.
  for (const tag of withinTag(hiddenTags.value, from)) {
    setTagHidden(tag, false);
    setTagHidden(moved(tag), true);
  }
  // The color goes with the name, unless the tag into which it merges has its
  // own color.
  for (const tag of withinTag(Object.keys(tagColors.value), from)) {
    const color = tagColors.value[tag];
    setTagColor(tag, null);
    if (color !== undefined && tagColors.value[moved(tag)] === undefined) {
      setTagColor(moved(tag), color);
    }
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

export async function removeTagFromNotes(
  tag: string,
  noteIds: Set<string>,
): Promise<boolean> {
  return await asBatch((batch) =>
    Promise.all(
      [...noteIds].map((id) => {
        const note = notes.peek().find((n) => n.id === id);
        if (!note?.tags.includes(tag)) return true;
        return updateNote(
          id,
          { tags: note.tags.filter((t) => t !== tag) },
          batch,
        );
      }),
    ),
  );
}

// --- Bulk ---

/**
 * Applies `act` to each selected note that still exists, as one operation, then
 * leaves select mode. The writes start together. Each shows its change before
 * it awaits anything. Thus, the board becomes stable one time.
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
  // To the start of the pinned section together, in their previous order.
  const ordered = notes
    .peek()
    .filter((n) => selectedNotes.value.has(n.id))
    .sort(byPosition);
  const heads = headPositions(notes.peek(), ordered.length);
  const at = new Map(ordered.map((n, i) => [n.id, heads[i]]));
  return await bulkApply((id, batch) => {
    const position = at.get(id);
    return updateNote(
      id,
      position === undefined ? { pinned: true } : { pinned: true, position },
      batch,
    );
  });
}

// One exit for the full selection. If the code used `archiveNote` or
// `trashNote` for each note, the cards would animate out one after the other.
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
  return await afterLeaving(
    [...selectedNotes.value],
    "undelete",
    RESTORED,
    () => bulkApply(restoreNow),
  );
}

export async function bulkSetColor(color: NoteColor): Promise<boolean> {
  return await bulkApply((id, batch) => updateNote(id, { color }, batch));
}

/**
 * Gives each selected note `tag`, or removes it from all of them. The selection
 * stays, as it does not for the other bulk actions. The tag panel stays open,
 * because a selection frequently gets several tags at the same time.
 */
export async function bulkSetTag(tag: string, on: boolean): Promise<boolean> {
  const ids = selectedNotes.value;
  return on
    ? await addTagToNotes(tag, ids)
    : await removeTagFromNotes(tag, ids);
}

// --- Order ---

/**
 * Spread each note out again, with the moved note at `at`. Over the full number
 * line, not only the dragged section. Thus, notes that are not on the screen
 * keep their position. Used only when `positionBetween` has no more space.
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
 * Moves one note within `noteIds`, the order of the dragged section before the
 * drop. The note goes immediately after the note behind which it was dropped,
 * on the full number line. Archived and trashed notes are off the screen but
 * share it. Thus, a midpoint between only the visible neighbors could be the
 * position of a hidden note. Only the moved note is written.
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
  // If the predecessor is not on the line for some reason, the note goes at the
  // start.
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

/** One step earlier or later, or fully to one of the ends. */
export type NoteMoveStep = -1 | 1 | "start" | "end";

/**
 * Where a note could move: one step earlier (`-1`) or later (`1`), or to one of
 * the ends of its section of the board (pinned or not). This is the keyboard
 * way to do what a drag does. Null where it cannot: the board is not in manual
 * order, or the note is already at that end.
 */
export function noteMoveTarget(
  id: string,
  step: NoteMoveStep,
): { ids: string[]; from: number; to: number } | null {
  if (!canReorder.peek()) return null;
  const note = allNotes.peek().find((n) => n.id === id);
  if (!note) return null;
  const ids = (note.pinned ? pinnedNotes : unpinnedNotes)
    .peek()
    .map((n) => n.id);
  const from = ids.indexOf(id);
  const to =
    step === "start" ? 0 : step === "end" ? ids.length - 1 : from + step;
  if (from === -1 || to === from || to < 0 || to >= ids.length) return null;
  return { ids, from, to };
}

/**
 * Moves a note one step, or to the start or end of its section, as
 * `noteMoveTarget` finds it. Tells where it went, one-based, for the caller to
 * announce, or null if it did not move.
 */
export async function moveNoteBy(
  id: string,
  step: NoteMoveStep,
): Promise<{ position: number; count: number } | null> {
  const target = noteMoveTarget(id, step);
  if (!target) return null;
  await reorderNotes(target.ids, target.from, target.to);
  return { position: target.to + 1, count: target.ids.length };
}

// --- Checklists ---

/**
 * Gives one of the images of a note its description, or removes it with "". The
 * code finds the image by its reference, because a different writer can have
 * moved it. If it was removed in the meantime, the code does not change it.
 */
export async function describeImage(
  id: string,
  image: string,
  alt: string,
): Promise<boolean> {
  // The descriptions are written with the list. Thus, the list must be
  // complete.
  const images = await ensureImages(id);
  const note = notes.value.find((n) => n.id === id);
  const index = images?.indexOf(image) ?? -1;
  if (!images || !note || index === -1) return false;
  const alts = imageAltsOf({ images, imageAlts: note.imageAlts ?? [] });
  alts[index] = alt;
  return updateNote(id, {
    images,
    imageAlts: alts.some((a) => a !== "") ? alts : [],
  });
}

export async function deleteCheckedItems(id: string) {
  const note = notes.value.find((n) => n.id === id);
  if (!note) return;
  const next = removeCheckedItems(note.content);
  if (next === note.content) return;
  await updateNote(id, { content: next });
}

/**
 * Clears each item of the checklists of a note, for a list that is used again.
 */
export async function uncheckAll(id: string) {
  const note = notes.value.find((n) => n.id === id);
  if (!note) return;
  const next = uncheckAllItems(note.content);
  if (next === note.content) return;
  await updateNote(id, { content: next });
}

export async function sortItemsByDate(id: string) {
  const note = notes.value.find((n) => n.id === id);
  if (!note) return;
  const next = sortChecklistByDate(note.content);
  if (next === note.content) return;
  await updateNote(id, { content: next });
}

export async function toggleCheckbox(id: string, lineIndex: number) {
  const note = notes.value.find((n) => n.id === id);
  if (!note) return;
  const toggled = toggleChecklistItem(note.content, lineIndex);
  if (toggled === null) return;
  const next = checkedItemsLast.value ? moveCheckedLast(toggled) : toggled;
  await updateNote(id, { content: next });
}
