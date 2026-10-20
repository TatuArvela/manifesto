// Where a dragged checklist item goes, calculated only from the levels and
// lists of the items. `taskItemDrag.ts` measures the page and gives the
// numbers. Nothing here reads the DOM. Thus, the rules can be tested without
// one.

export const INDENT_PX = 24;

/**
 * The maximum height above a finger at which a touch drag aims. The finger
 * covers its row and the line under it. Thus, the item is held up where you can
 * see it, and the drop goes where the item is drawn, not under the fingertip.
 *
 * The lift grows with the travel of the finger, at half its speed. It is not
 * there from the start. When it was there immediately, the aim started one row
 * up, and an item released where it was picked up moved one slot.
 */
export const TOUCH_LIFT_PX = 44;

/** What the rules need of an item: its depth, and its list. */
export interface DropItem {
  level: number;
  /** The top-level list of the item, or below 0 for none. */
  outerListPos: number;
}

/**
 * The slot before the first of `count` items whose line has its middle below
 * `y`. The code asks for the middles one at a time. Thus, a drag near the top
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
 * The item above or below `slot`. It skips the dragged item, which is still in
 * the list where it was picked up.
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
 * The two items around `slot` when they are in different lists. There, a drop
 * must select between the end of the first list and the start of the second.
 * Null in all other places.
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
 * The level at which a drop goes: the own level of the dragged item, moved one
 * for each `INDENT_PX` to the side. Never deeper than one under the item above,
 * and never shallower than the item below (which would otherwise become its
 * child).
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

/** How far above a finger the drop aims after `travel`. It only grows. */
export function touchLift(lift: number, travel: number): number {
  return Math.max(lift, Math.min(TOUCH_LIFT_PX, Math.abs(travel) / 2));
}
