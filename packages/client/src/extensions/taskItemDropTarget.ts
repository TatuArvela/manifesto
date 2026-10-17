// Where a dragged checklist item lands, worked out from the items' levels and
// lists alone. `taskItemDrag.ts` measures the page and hands the numbers in;
// nothing here reads the DOM, so the rules can be tested without one.

export const INDENT_PX = 24;

/**
 * How far above a finger a touch drag aims, at most. The finger covers the row
 * it is on and the line under it, so the item is held up where it can be seen
 * and the drop goes where the item is drawn, not under the fingertip.
 *
 * The lift grows with the finger's travel, at half its pace, rather than
 * being there from the start: lifted at once, the aim began a row up, and an
 * item let go where it was picked up moved one slot.
 */
export const TOUCH_LIFT_PX = 44;

/** What the rules need of an item: how deep it is, and which list it is in. */
export interface DropItem {
  level: number;
  /** The top-level list the item belongs to, or below 0 for none. */
  outerListPos: number;
}

/**
 * The slot before the first of `count` items whose line's middle is below
 * `y`. The middles are asked for one at a time, so a drag near the top
 * measures only the lines above it.
 */
export function slotAt(
  count: number,
  lineMiddle: (index: number) => number,
  y: number,
): number {
  for (let i = 0; i < count; i++) {
    if (y < lineMiddle(i)) return i;
  }
  return count;
}

/**
 * The item above or below `slot`, stepping over the one being dragged, which
 * is still in the list where it was picked up.
 */
export function neighborIndex(
  slot: number,
  sourceIdx: number,
  side: "above" | "below",
): number {
  if (side === "above") {
    const idx = slot - 1;
    return idx === sourceIdx ? idx - 1 : idx;
  }
  return slot === sourceIdx ? slot + 1 : slot;
}

/**
 * The two items around `slot` when they are in different lists, which is
 * where a drop has to choose between the end of the first and the start of
 * the second; null anywhere else.
 */
export function listBoundaryAt<T extends DropItem>(
  items: readonly T[],
  slot: number,
  sourceIdx: number,
): { above: T; below: T } | null {
  const above = items[neighborIndex(slot, sourceIdx, "above")];
  const below = items[neighborIndex(slot, sourceIdx, "below")];
  if (!above || !below) return null;
  if (above.outerListPos < 0 || below.outerListPos < 0) return null;
  if (above.outerListPos === below.outerListPos) return null;
  return { above, below };
}

/**
 * The level a drop lands at: the dragged item's own, moved one for every
 * `INDENT_PX` sideways, but never deeper than one under the item above, nor
 * shallower than the item below (which would otherwise become its child).
 */
export function dropLevel(
  items: readonly DropItem[],
  slot: number,
  sourceIdx: number,
  sourceLevel: number,
  deltaX: number,
  atListEnd: boolean,
): number {
  const aboveIdx = neighborIndex(slot, sourceIdx, "above");
  const above = aboveIdx >= 0 ? items[aboveIdx] : null;

  const belowIdx = neighborIndex(slot, sourceIdx, "below");
  const below = !atListEnd && belowIdx < items.length ? items[belowIdx] : null;

  const maxLevel = above ? above.level + 1 : 1;
  const minLevel = below ? below.level : 1;
  const desired = sourceLevel + Math.round(deltaX / INDENT_PX);
  return Math.max(minLevel, Math.min(maxLevel, desired));
}

/** How far above a finger the drop is aimed after `travel`; it only grows. */
export function touchLift(lift: number, travel: number): number {
  return Math.max(lift, Math.min(TOUCH_LIFT_PX, Math.abs(travel) / 2));
}
