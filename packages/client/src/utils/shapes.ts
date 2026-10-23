// The geometry of the shape tools of the drawing pad: where a drag puts a
// line, a box or an ellipse, and when a polygon is closed. Pure, so that the
// tests need no pointer.

import type { Point } from "./drawing.ts";

/** A line held by Shift goes in steps of this angle. */
const LINE_STEP = Math.PI / 12;

/** The end of a line from `from` toward `to`, at a step of 15 degrees. */
export function snapLine(from: Point, to: Point): Point {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  const angle = Math.round(Math.atan2(dy, dx) / LINE_STEP) * LINE_STEP;
  return [
    from[0] + Math.cos(angle) * length,
    from[1] + Math.sin(angle) * length,
  ];
}

/**
 * The far corner of a box from `from` toward `to` with equal sides: a square,
 * or the box of a circle. The longer side sets the size.
 */
export function snapSquare(from: Point, to: Point): Point {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return [
    from[0] + Math.sign(dx || 1) * side,
    from[1] + Math.sign(dy || 1) * side,
  ];
}

/**
 * True when a press at `at` closes the polygon: it has three corners or more,
 * and the press is within `reach` of the first one.
 */
export function closesPolygon(
  corners: readonly Point[],
  at: Point,
  reach: number,
): boolean {
  const [first] = corners;
  if (!first || corners.length < 3) return false;
  return Math.hypot(at[0] - first[0], at[1] - first[1]) <= reach;
}
