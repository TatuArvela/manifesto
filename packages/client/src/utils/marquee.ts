/**
 * The geometry behind drag-to-select on the note grid, kept apart from the
 * hook so it tests without a DOM.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The box two corners span, whichever way the drag went. */
export function boxFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Box {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

/** Whether two boxes overlap by any area; touching edges do not count. */
export function boxesIntersect(a: Box, b: Box): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

/**
 * The selection a drag produces: the notes under the box, added to what was
 * already selected when the drag began with Shift or Cmd/Ctrl held, and in
 * place of it otherwise, the way a file manager behaves.
 */
export function marqueeSelection(
  base: ReadonlySet<string>,
  hit: readonly string[],
  additive: boolean,
): Set<string> {
  const next = new Set(additive ? base : []);
  for (const id of hit) next.add(id);
  return next;
}

/**
 * How far to scroll per frame while the pointer is held near the top or
 * bottom edge of the scroll area, so a selection can reach notes off screen.
 * Faster the closer it gets, up to `max`; zero away from the edges.
 */
export function edgeScrollStep(
  pointerY: number,
  top: number,
  bottom: number,
  zone = 48,
  max = 18,
): number {
  if (pointerY < top + zone) {
    return -Math.ceil((max * Math.min(zone, top + zone - pointerY)) / zone);
  }
  if (pointerY > bottom - zone) {
    return Math.ceil((max * Math.min(zone, pointerY - (bottom - zone))) / zone);
  }
  return 0;
}
