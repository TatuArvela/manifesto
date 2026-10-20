import type { Note } from "@manifesto/shared";

/**
 * The manual order of notes: one float `position` for each note, shared by all
 * views, also archived and trashed notes. Pure. Thus, the arithmetic is tested
 * without a store.
 */

/**
 * The gap that a new numbering leaves between two notes. Thus, a note dropped
 * between them can take its own number, and nothing else moves.
 */
export const POSITION_STEP = 1000;

/**
 * Manual order: by `position`, and by id where two notes have the same
 * position. Two devices can select the same midpoint, and a backup can carry a
 * duplicate. Without a second key, two devices do not agree about the order.
 * Ids are ULIDs, and thus sort by themselves.
 */
export function byPosition(a: Note, b: Note): number {
  return a.position - b.position || a.id.localeCompare(b.id);
}

/**
 * The position that puts one note before all of `held`. See {@link
 * headPositions}.
 */
export function headPosition(held: readonly Note[]): number {
  let lowest = -Date.now();
  for (const note of held) {
    if (note.position - POSITION_STEP < lowest) {
      lowest = note.position - POSITION_STEP;
    }
  }
  return lowest;
}

/**
 * `count` positions before each note in `held`: where new notes go, and where a
 * note goes when pinned. Minus the clock. Thus, notes created on two devices
 * show newest first when both lists meet. One step before the lowest held note
 * when that is even more forward. The first slot is the top. Thus, a group
 * keeps its own order.
 */
export function headPositions(held: readonly Note[], count: number): number[] {
  const lowest = headPosition(held);
  return Array.from(
    { length: count },
    (_, i) => lowest - (count - 1 - i) * POSITION_STEP,
  );
}

/**
 * Halfway between two neighbors. `position` is a double in both storage
 * drivers. Thus, a {@link POSITION_STEP} gap stays usable for approximately
 * fifty halvings. Null when there is no space left between them (a gap halved
 * to nothing, or a pair that is equal or in the wrong order). Then the caller
 * must number again.
 */
export function positionBetween(
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
