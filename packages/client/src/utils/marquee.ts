/**
 * The geometry of drag-to-select on the note grid, kept separate from the hook.
 * Thus, it is tested without a DOM.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The box that two corners make, whatever the direction of the drag. */
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

/** If two boxes overlap by some area. Edges that touch do not count. */
export function boxesIntersect(a: Box, b: Box): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

/**
 * The selection that a drag makes: the notes under the box. When the drag
 * started with Shift or Cmd/Ctrl held, they are added to the previous
 * selection. Otherwise, they replace it, as a file manager does.
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
 * How far to scroll in each frame while the pointer is held near the top or
 * bottom edge of the scroll area. Thus, a selection can reach notes off the
 * screen. It is faster nearer the edge, up to `max`, and zero away from the
 * edges.
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
