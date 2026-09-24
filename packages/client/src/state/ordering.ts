import type { Note } from "@manifesto/shared";

/**
 * The manual order of notes: one float `position` per note, shared by every
 * view, archived and trashed notes included. Pure, so the arithmetic tests
 * without a store.
 */

/**
 * The gap a fresh numbering leaves between two notes, so a note dropped
 * between them can take a number of its own without moving anything else.
 */
export const POSITION_STEP = 1000;

/**
 * Manual order: by `position`, and by id where two notes share one. Two
 * devices can pick the same midpoint and a backup can carry a duplicate, and
 * without a second key two devices disagree about the order. Ids are ULIDs
 * and so sort by themselves.
 */
export function byPosition(a: Note, b: Note): number {
  return a.position - b.position || a.id.localeCompare(b.id);
}

/**
 * `count` positions ahead of every note in `held`: where new notes go, and
 * where a note goes when pinned. Minus the clock, so notes created on two
 * devices come out newest first once both lists meet, and a step ahead of the
 * lowest held note when that is further ahead still. The first slot is the
 * topmost, so a group keeps its order among itself.
 */
export function headPositions(held: readonly Note[], count: number): number[] {
  let lowest = -Date.now();
  for (const note of held) {
    if (note.position - POSITION_STEP < lowest) {
      lowest = note.position - POSITION_STEP;
    }
  }
  return Array.from(
    { length: count },
    (_, i) => lowest - (count - 1 - i) * POSITION_STEP,
  );
}

/**
 * Halfway between two neighbours. `position` is a double in both storage
 * drivers, so a {@link POSITION_STEP} gap survives about fifty halvings. Null
 * when there is no room left between them (a gap halved away, or a pair that
 * is tied or out of order), which is the caller's cue to renumber.
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
