// The selected area of a drawing on the pad: a mask, one pixel of it for each
// pixel of the paper, in the box around it. A rectangle or a freehand shape
// makes a new area, adds to it, or takes a part away. Thus, the area can have
// any shape, and holes.

import {
  blankCanvas,
  type Clip,
  intersect,
  isClip,
  isFill,
  isShape,
  type Mark,
  type Point,
  type Rect,
} from "./drawing.ts";

export interface Selection {
  /** Opaque inside the area, transparent outside it. The size of `bounds`. */
  mask: HTMLCanvasElement;
  /** The box around the area on the paper, in whole pixels. */
  bounds: Rect;
}

/** What a drag of a selection tool draws. */
export type SelectShape =
  | { kind: "rect"; rect: Rect }
  | { kind: "ellipse"; rect: Rect }
  | { kind: "lasso"; points: readonly Point[] };

/**
 * How a new shape changes the area: in its place, added, taken away, or only
 * the part that both share.
 */
export type SelectMode = "replace" | "add" | "subtract" | "intersect";

/** The box around a shape, in whole pixels. Null for a shape with no area. */
export function shapeBounds(shape: SelectShape): Rect | null {
  const points =
    shape.kind !== "lasso"
      ? [
          [shape.rect.x, shape.rect.y] as Point,
          [shape.rect.x + shape.rect.width, shape.rect.y + shape.rect.height],
        ]
      : shape.points;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  const x = Math.floor(left);
  const y = Math.floor(top);
  const width = Math.ceil(right) - x;
  const height = Math.ceil(bottom) - y;
  if (!(width > 0 && height > 0)) return null;
  if (shape.kind === "lasso" && shape.points.length < 3) return null;
  return { x, y, width, height };
}

/** Adds the outline of a shape to the path in progress. */
export function selectShapePath(
  ctx: CanvasRenderingContext2D,
  shape: SelectShape,
): void {
  if (shape.kind === "rect") {
    const { x, y, width, height } = shape.rect;
    ctx.rect(x, y, width, height);
    return;
  }
  if (shape.kind === "ellipse") {
    const { x, y, width, height } = shape.rect;
    ctx.ellipse(
      x + width / 2,
      y + height / 2,
      width / 2,
      height / 2,
      0,
      0,
      Math.PI * 2,
    );
    return;
  }
  const [first, ...rest] = shape.points;
  if (!first) return;
  ctx.moveTo(first[0], first[1]);
  for (const [x, y] of rest) ctx.lineTo(x, y);
  ctx.closePath();
}

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

/**
 * The box of the opaque part of a mask, relative to the mask. Null when it is
 * all transparent: the area is empty.
 */
function opaqueBox(mask: HTMLCanvasElement): Rect | null {
  const ctx = mask.getContext("2d");
  if (!ctx) return null;
  const { width, height } = mask;
  const { data } = ctx.getImageData(0, 0, width, height);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) < 128) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * The area after a shape: in place of the old one, added to it, or taken
 * away from it. Only the part inside `limit` (what the paper shows) counts.
 * Null when nothing stays selected.
 */
export function combineSelection(
  current: Selection | null,
  shape: SelectShape,
  mode: SelectMode,
  limit: Rect,
): Selection | null {
  const drawn = shapeBounds(shape);
  const base = mode === "replace" ? null : current;
  if ((mode === "subtract" || mode === "intersect") && !base) return null;
  const reach = !base
    ? drawn
    : mode === "add" && drawn
      ? union(base.bounds, drawn)
      : mode === "intersect"
        ? drawn && intersect(base.bounds, drawn)
        : base.bounds;
  const bounds = reach && intersect(reach, limit);
  if (!bounds) return mode === "subtract" ? base : null;
  const box = {
    x: Math.floor(bounds.x),
    y: Math.floor(bounds.y),
    width: Math.ceil(bounds.width),
    height: Math.ceil(bounds.height),
  };
  const mask = blankCanvas(box);
  const ctx = mask.getContext("2d");
  if (!ctx) return current;
  ctx.translate(-box.x, -box.y);
  if (base) ctx.drawImage(base.mask, base.bounds.x, base.bounds.y);
  ctx.globalCompositeOperation =
    mode === "subtract"
      ? "destination-out"
      : mode === "intersect"
        ? "destination-in"
        : "source-over";
  ctx.fillStyle = "#000";
  ctx.beginPath();
  selectShapePath(ctx, shape);
  ctx.fill();
  return trimmed({ mask, bounds: box });
}

/** The paper in whole pixels: the box of an area that covers all of `limit`. */
const wholePixels = (limit: Rect): Rect => {
  const x = Math.floor(limit.x);
  const y = Math.floor(limit.y);
  return {
    x,
    y,
    width: Math.ceil(limit.x + limit.width) - x,
    height: Math.ceil(limit.y + limit.height) - y,
  };
};

/** An area that is all of `limit`. */
export function selectAll(limit: Rect): Selection | null {
  return invertSelection(null, limit);
}

/**
 * The part of `limit` that is outside the area. With no area, all of `limit`.
 * Null when nothing stays selected.
 */
export function invertSelection(
  current: Selection | null,
  limit: Rect,
): Selection | null {
  const box = wholePixels(limit);
  if (!(box.width > 0 && box.height > 0)) return null;
  const mask = blankCanvas(box);
  const ctx = mask.getContext("2d");
  if (!ctx) return current;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, box.width, box.height);
  if (current) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(
      current.mask,
      current.bounds.x - box.x,
      current.bounds.y - box.y,
    );
  }
  return trimmed({ mask, bounds: box });
}

/** The selection in the box of what is opaque in it, or null when nothing is. */
function trimmed(selection: Selection): Selection | null {
  const inner = opaqueBox(selection.mask);
  if (!inner) return null;
  if (
    inner.width === selection.mask.width &&
    inner.height === selection.mask.height
  ) {
    return selection;
  }
  const mask = blankCanvas(inner);
  mask.getContext("2d")?.drawImage(selection.mask, -inner.x, -inner.y);
  return {
    mask,
    bounds: {
      x: selection.bounds.x + inner.x,
      y: selection.bounds.y + inner.y,
      width: inner.width,
      height: inner.height,
    },
  };
}

/** The same area, moved by whole pixels. The mask does not change. */
export const moveSelection = (
  selection: Selection,
  dx: number,
  dy: number,
): Selection => ({
  mask: selection.mask,
  bounds: {
    ...selection.bounds,
    x: selection.bounds.x + Math.round(dx),
    y: selection.bounds.y + Math.round(dy),
  },
});

/** True when a point of the paper is inside the area. */
export function selectionContains(selection: Selection, at: Point): boolean {
  const x = Math.floor(at[0] - selection.bounds.x);
  const y = Math.floor(at[1] - selection.bounds.y);
  if (x < 0 || y < 0) return false;
  if (x >= selection.bounds.width || y >= selection.bounds.height) {
    return false;
  }
  const alpha = selection.mask.getContext("2d")?.getImageData(x, y, 1, 1)
    .data[3];
  return (alpha ?? 0) >= 128;
}

/**
 * A mark that shows only inside the area. An eraser stays an eraser: it takes
 * ink away from the layer, inside the area only.
 */
export function inArea(mark: Mark, selection: Selection): Clip {
  if (isClip(mark) || isFill(mark) || isShape(mark) || !mark.erase) {
    return { clip: selection.bounds, mask: selection.mask, marks: [mark] };
  }
  return {
    clip: selection.bounds,
    mask: selection.mask,
    erase: true,
    marks: [{ ...mark, erase: false }],
  };
}
