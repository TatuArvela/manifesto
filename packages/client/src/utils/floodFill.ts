// The area that a flood fill covers on a picture: the pixels joined to the
// pressed one that have nearly its color. Pure, on the bytes of the picture.
// Thus, it can be tested without a canvas.

import type { Rect } from "./drawing.ts";
import { blankCanvas } from "./drawingRender.ts";

export interface FillArea {
  /** One byte for each pixel of the picture: 1 inside the area. */
  mask: Uint8Array;
  width: number;
  height: number;
  /** The smallest box around the area. */
  bounds: Rect;
}

/**
 * How far a channel can be from the pressed color, from 0 to 255. Enough for
 * the soft edge of a line to stop the fill, and for the small noise of a JPEG
 * not to.
 */
export const FILL_TOLERANCE = 48;

/**
 * The area from `(x, y)` on RGBA bytes, row by row. A run of a row goes on the
 * stack at most one time from each of the two runs next to it. Thus, the work
 * is bounded by the size of the picture. Null for a point outside it.
 */
export function floodFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  tolerance = FILL_TOLERANCE,
): FillArea | null {
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;
  const seed = (sy * width + sx) * 4;
  const r = data[seed] ?? 0;
  const g = data[seed + 1] ?? 0;
  const b = data[seed + 2] ?? 0;
  const a = data[seed + 3] ?? 0;
  const near = (i: number) => {
    const p = i * 4;
    return (
      Math.abs((data[p] ?? 0) - r) <= tolerance &&
      Math.abs((data[p + 1] ?? 0) - g) <= tolerance &&
      Math.abs((data[p + 2] ?? 0) - b) <= tolerance &&
      Math.abs((data[p + 3] ?? 0) - a) <= tolerance
    );
  };
  const mask = new Uint8Array(width * height);
  let left = sx;
  let right = sx;
  let top = sy;
  let bottom = sy;
  const stack = [sy * width + sx];
  while (stack.length > 0) {
    const i = stack.pop() ?? 0;
    if (mask[i] || !near(i)) continue;
    // The run of the row through this pixel, as far as the color goes.
    const row = Math.floor(i / width);
    let start = i;
    while (start % width > 0 && !mask[start - 1] && near(start - 1)) start--;
    let end = i;
    while ((end + 1) % width > 0 && !mask[end + 1] && near(end + 1)) end++;
    // One seed for each run of the rows above and below, not one for each
    // pixel. Thus, the stack stays small on a large empty paper.
    let above = false;
    let below = false;
    for (let p = start; p <= end; p++) {
      mask[p] = 1;
      if (row > 0) {
        const open = !mask[p - width] && near(p - width);
        if (open && !above) stack.push(p - width);
        above = open;
      }
      if (row < height - 1) {
        const open = !mask[p + width] && near(p + width);
        if (open && !below) stack.push(p + width);
        below = open;
      }
    }
    left = Math.min(left, start % width);
    right = Math.max(right, end % width);
    top = Math.min(top, row);
    bottom = Math.max(bottom, row);
  }
  return {
    mask,
    width,
    height,
    bounds: {
      x: left,
      y: top,
      width: right - left + 1,
      height: bottom - top + 1,
    },
  };
}

/**
 * The area with one more pixel on each side. A line has a soft edge that the
 * fill stops before. Without this, a thin pale seam stays between the fill and
 * the line.
 */
export function growArea(area: FillArea): FillArea {
  const { mask, width, height, bounds } = area;
  const grown = new Uint8Array(mask);
  const x0 = Math.max(0, bounds.x - 1);
  const y0 = Math.max(0, bounds.y - 1);
  const x1 = Math.min(width - 1, bounds.x + bounds.width);
  const y1 = Math.min(height - 1, bounds.y + bounds.height);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * width + x;
      if (mask[i]) continue;
      if (
        (x > 0 && mask[i - 1]) ||
        (x < width - 1 && mask[i + 1]) ||
        (y > 0 && mask[i - width]) ||
        (y < height - 1 && mask[i + width])
      ) {
        grown[i] = 1;
      }
    }
  }
  return {
    mask: grown,
    width,
    height,
    bounds: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 },
  };
}

/**
 * The area as a picture of its box, in `color` (`#rrggbb`), opaque inside and
 * transparent outside. Null where the browser gives no canvas.
 */
export function fillPicture(
  area: FillArea,
  color: string,
): HTMLCanvasElement | null {
  const { bounds, mask, width } = area;
  const image = blankCanvas(bounds);
  const ctx = image.getContext("2d");
  if (!ctx) return null;
  const pixels = ctx.createImageData(bounds.width, bounds.height);
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) =>
    Number.parseInt(color.slice(i, i + 2), 16),
  );
  for (let row = 0; row < bounds.height; row++) {
    for (let col = 0; col < bounds.width; col++) {
      if (!mask[(bounds.y + row) * width + bounds.x + col]) continue;
      const p = (row * bounds.width + col) * 4;
      pixels.data[p] = r;
      pixels.data[p + 1] = g;
      pixels.data[p + 2] = b;
      pixels.data[p + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return image;
}
