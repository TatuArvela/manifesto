// How the marks of a drawing are put on a canvas, and how the canvas is saved
// as an image file.

import {
  type Clip,
  type Fill,
  intersect,
  isClip,
  isFill,
  isShape,
  type Mark,
  markBounds,
  PAPER,
  type PaperSize,
  type Rect,
  type Shape,
} from "./drawing.ts";
import type { Layer } from "./drawingLayers.ts";
import { drawStroke } from "./penTip.ts";

/** An empty, transparent canvas of a size. */
export function blankCanvas(size: PaperSize): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  return canvas;
}

/**
 * `kept` again when it has the size, or a new canvas. A canvas of a large photo
 * holds tens of megabytes, and a phone has a limit for all of them together.
 * The contents stay: the caller paints over them.
 */
export const reusedCanvas = (
  kept: HTMLCanvasElement | null | undefined,
  size: PaperSize,
): HTMLCanvasElement =>
  kept && kept.width === size.width && kept.height === size.height
    ? kept
    : blankCanvas(size);

/**
 * The context of a canvas that ink is drawn on. On the GPU, Chrome changes how
 * it smooths the edge of a path as the path gets long: a line in progress
 * moves, and moves again at the release. On the CPU, the edge stays the same.
 * The live frames use it too, so that a line keeps its shape at the release.
 */
export const CPU_INK: CanvasRenderingContext2DSettings = {
  willReadFrequently: true,
};

/** The canvas on which `renderDrawing` paints each layer before it adds it. */
let layerScratch: HTMLCanvasElement | null = null;

/** The outline of a shape, as a path in progress. */
export function markShapePath(
  ctx: CanvasRenderingContext2D | Path2D,
  shape: Pick<Shape, "shape" | "points">,
): void {
  const [a, b] = shape.points;
  if (!a) return;
  if (shape.shape === "polygon") {
    ctx.moveTo(a[0], a[1]);
    for (const point of shape.points.slice(1)) ctx.lineTo(point[0], point[1]);
    ctx.closePath();
    return;
  }
  if (!b) return;
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  const width = Math.abs(b[0] - a[0]);
  const height = Math.abs(b[1] - a[1]);
  if (shape.shape === "rect") {
    ctx.rect(x, y, width, height);
    return;
  }
  ctx.moveTo(x + width, y + height / 2);
  ctx.ellipse(
    x + width / 2,
    y + height / 2,
    width / 2,
    height / 2,
    0,
    0,
    Math.PI * 2,
  );
}

/** A shape: its inside first, then its outline over it. */
export function drawShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  ctx.globalAlpha = shape.opacity ?? 1;
  ctx.beginPath();
  markShapePath(ctx, shape);
  if (shape.fill) {
    ctx.fillStyle = shape.fill;
    ctx.fill();
  }
  if (shape.color && shape.width > 0) {
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.width;
    // A box keeps square corners. The corners of a polygon can be very sharp,
    // and a mitre would go far past them.
    ctx.lineJoin = shape.shape === "rect" ? "miter" : "round";
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Marks in order. A group is cut to its area, and its marks only. */
export function drawMarks(
  ctx: CanvasRenderingContext2D,
  marks: readonly Mark[],
): void {
  for (const mark of marks) {
    if (isFill(mark)) {
      ctx.globalAlpha = mark.opacity ?? 1;
      ctx.drawImage(
        mark.image,
        mark.at.x,
        mark.at.y,
        mark.at.width,
        mark.at.height,
      );
      ctx.globalAlpha = 1;
      continue;
    }
    if (isShape(mark)) {
      drawShape(ctx, mark);
      continue;
    }
    if (!isClip(mark)) {
      drawStroke(ctx, mark);
      continue;
    }
    if (mark.mask) {
      drawMasked(ctx, mark, mark.mask);
      continue;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(mark.clip.x, mark.clip.y, mark.clip.width, mark.clip.height);
    ctx.clip();
    drawMarks(ctx, mark.marks);
    ctx.restore();
  }
}

/** Canvases for the groups with a mask, one for each depth of nesting. */
const maskScratch: HTMLCanvasElement[] = [];
let maskDepth = 0;

/**
 * The pixels of the canvas that a box of the paper covers, under the
 * transform of `ctx`, rounded out to whole pixels and held inside the canvas.
 * Null when it is outside the canvas.
 */
function canvasArea(ctx: CanvasRenderingContext2D, box: Rect) {
  const m = ctx.getTransform();
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ] as const) {
    xs.push(m.a * px + m.c * py + m.e);
    ys.push(m.b * px + m.d * py + m.f);
  }
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const right = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs)));
  const bottom = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys)));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * A group with a mask: its marks on a canvas of their own, cut to the mask
 * there, then put on the drawing. As ink, or, for an eraser, as the ink that
 * goes. A clip path cannot have holes, and a mask can.
 *
 * Inside a mask, the work stays in the box of the mask on the canvas: a line
 * in a small selected area does not cost a pass over the whole picture. Ink
 * outside a mask can be anywhere, and takes the whole canvas.
 */
function drawMasked(
  ctx: CanvasRenderingContext2D,
  mark: Clip,
  mask: CanvasImageSource,
): void {
  const { width, height } = ctx.canvas;
  const area = mark.outside
    ? { x: 0, y: 0, width, height }
    : canvasArea(ctx, mark.clip);
  if (!area) return;
  const scratch = reusedCanvas(maskScratch[maskDepth], { width, height });
  maskScratch[maskDepth] = scratch;
  const own = scratch.getContext("2d", CPU_INK);
  if (!own) return;
  own.save();
  own.setTransform(1, 0, 0, 1, 0, 0);
  own.clearRect(area.x, area.y, area.width, area.height);
  // Drawing and compositing outside the area would only cost time.
  own.beginPath();
  own.rect(area.x, area.y, area.width, area.height);
  own.clip();
  own.setTransform(ctx.getTransform());
  maskDepth++;
  try {
    drawMarks(own, mark.marks);
  } finally {
    maskDepth--;
  }
  // Destination-in keeps the marks where the mask is, and clears all the
  // rest of the area. Destination-out takes away what is inside the mask.
  own.globalCompositeOperation = mark.outside
    ? "destination-out"
    : "destination-in";
  const { x, y, width: w, height: h } = mark.clip;
  own.drawImage(mask, x, y, w, h);
  own.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (mark.erase) ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(
    scratch,
    area.x,
    area.y,
    area.width,
    area.height,
    area.x,
    area.y,
    area.width,
    area.height,
  );
  ctx.restore();
}

/**
 * The marks of one layer on `scratch`, from nothing, with `view` as the part
 * of the paper that the canvas shows. On its own canvas, an eraser takes away
 * only the ink of that layer.
 */
export function paintLayer(
  scratch: HTMLCanvasElement,
  marks: readonly Mark[],
  view: Pick<Rect, "x" | "y"> = { x: 0, y: 0 },
): void {
  const ctx = scratch.getContext("2d", CPU_INK);
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, scratch.width, scratch.height);
  ctx.setTransform(1, 0, 0, 1, -view.x, -view.y);
  drawMarks(ctx, marks);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Fewer pixels than the limit of one canvas in Safari, with some to spare. */
const MAX_LAYER_PIXELS = 16_000_000;

/**
 * The part of the plane where a layer keeps ink: the paper, and a margin
 * around it. Ink can go past the edge of the paper and come back. The area is
 * at most twice the paper on each axis, and stays inside the pixel limit of a
 * canvas.
 */
export function inkArea(paper: PaperSize): Rect {
  const grow = Math.min(
    2,
    Math.sqrt(MAX_LAYER_PIXELS / (paper.width * paper.height)),
  );
  const width = Math.floor(paper.width * grow);
  const height = Math.floor(paper.height * grow);
  return {
    x: Math.round((paper.width - width) / 2),
    y: Math.round((paper.height - height) / 2),
    width,
    height,
  };
}

/**
 * The ink of marks as one picture, in whole pixels, cut to `area`. Null when
 * they have no ink there. A move or a resize after it changes pixels, not
 * lines: this is a bitmap pad.
 */
export function rasterize(marks: readonly Mark[], area: Rect): Fill | null {
  const ink = markBounds(marks);
  const shown = ink && intersect(ink, area);
  if (!shown) return null;
  const x = Math.floor(shown.x);
  const y = Math.floor(shown.y);
  const at = {
    x,
    y,
    width: Math.ceil(shown.x + shown.width) - x,
    height: Math.ceil(shown.y + shown.height) - y,
  };
  const image = blankCanvas(at);
  paintLayer(image, marks, at);
  return { image, at };
}

/**
 * The full drawing from nothing: paper, then each layer that shows, from the
 * bottom up. The paper stays under an image on a layer. Thus, an image with
 * transparent parts is as opaque as all other drawings. With `onlyLayers`, it
 * is the given layers alone, on a transparent ground: the pad keeps those under
 * and over the line in progress. The canvas is the size of `view`, the part of
 * the paper that the picture keeps after a crop.
 */
export function renderDrawing(
  ctx: CanvasRenderingContext2D,
  layers: readonly Layer[],
  view: Rect,
  onlyLayers = false,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (onlyLayers) {
    ctx.clearRect(0, 0, view.width, view.height);
  } else {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, view.width, view.height);
  }
  let scratch: HTMLCanvasElement | null = null;
  for (const layer of layers) {
    if (!layer.visible || layer.marks.length === 0) continue;
    scratch ??= layerScratch = reusedCanvas(layerScratch, view);
    paintLayer(scratch, layer.marks, view);
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.drawImage(scratch, 0, 0);
    ctx.globalAlpha = 1;
  }
}

/** Above this, a PNG is a photograph, not line art, and is saved as one. */
const PNG_BYTES = 1024 * 1024;
const PHOTO_QUALITY = 0.92;

const encoded = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * The canvas as the bytes of an image file, or null where the browser made
 * none. A PNG, which keeps a line sharp however frequently the drawing opens
 * again, unless it is drawn over a photograph. As a PNG, that becomes many
 * megabytes, more than a note accepts. Thus, it is a JPEG, as the photograph
 * was.
 */
export async function encodeDrawing(
  canvas: HTMLCanvasElement,
  overImage: boolean,
): Promise<Blob | null> {
  const png = await encoded(canvas, "image/png");
  if (!png || !overImage || png.size <= PNG_BYTES) return png;
  const jpeg = await encoded(canvas, "image/jpeg", PHOTO_QUALITY);
  return jpeg && jpeg.type === "image/jpeg" && jpeg.size < png.size
    ? jpeg
    : png;
}
