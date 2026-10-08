// A drawing as the strokes it was made of, and how they are put on a canvas.
// Kept apart from the pad that collects them so the geometry can be tested
// without a pointer.

import { MAX_IMAGE_EDGE } from "./shrinkImage.js";

/** The drawing's own size, whatever size it is shown at: 4 by 3. */
export const DRAWING_WIDTH = 1600;
export const DRAWING_HEIGHT = 1200;

export interface PaperSize {
  width: number;
  height: number;
}

/** A new drawing's paper. */
export const BLANK_PAPER: PaperSize = {
  width: DRAWING_WIDTH,
  height: DRAWING_HEIGHT,
};

/**
 * The paper for drawing over an image: the image's own shape, with its long
 * edge no shorter than a new drawing's (a line on a thumbnail would be a row
 * of blocks) and no longer than an attached image is kept at. Null for an
 * image with no size to speak of.
 */
export function paperSizeFor(image: PaperSize): PaperSize | null {
  const longEdge = Math.max(image.width, image.height);
  if (!(image.width > 0 && image.height > 0)) return null;
  const scale =
    Math.min(MAX_IMAGE_EDGE, Math.max(DRAWING_WIDTH, longEdge)) / longEdge;
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  };
}

/** How much wider a pen is on `paper` than on a new drawing's, so it looks
 * the same width on screen whatever the paper's size. */
export function penScale(paper: PaperSize): number {
  return Math.max(paper.width, paper.height) / DRAWING_WIDTH;
}
/** Paper: a drawing is opaque, so it reads the same on a note of any colour
 * and in either theme, where transparent ink on a dark note would vanish. */
export const PAPER = "#ffffff";

export type Point = readonly [x: number, y: number];

export interface Stroke {
  color: string;
  /** In the drawing's own pixels. */
  width: number;
  points: Point[];
}

/**
 * Where a pointer is on the drawing, from where it is on the screen. The
 * canvas is shown smaller than it is, so both axes scale by how much.
 */
export function drawingPoint(
  pointer: { clientX: number; clientY: number },
  shown: { left: number; top: number; width: number; height: number },
  paper: PaperSize = BLANK_PAPER,
): Point {
  const x = ((pointer.clientX - shown.left) / shown.width) * paper.width;
  const y = ((pointer.clientY - shown.top) / shown.height) * paper.height;
  return [
    Math.min(paper.width, Math.max(0, x)),
    Math.min(paper.height, Math.max(0, y)),
  ];
}

/**
 * One stroke, as a line through the middle of each pair of points with the
 * points themselves as the curve's handles: a hand moving fast leaves points
 * far apart, and straight segments between them show every corner.
 */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
): void {
  const [first, ...rest] = stroke.points;
  if (!first) return;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // A tap, or a finger that pressed and never moved: a path with no length
  // draws nothing, so it is a dot the width of the pen.
  if (rest.every((point) => point[0] === first[0] && point[1] === first[1])) {
    ctx.beginPath();
    ctx.arc(first[0], first[1], stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(first[0], first[1]);
  let previous = first;
  for (const point of rest) {
    ctx.quadraticCurveTo(
      previous[0],
      previous[1],
      (previous[0] + point[0]) / 2,
      (previous[1] + point[1]) / 2,
    );
    previous = point;
  }
  ctx.lineTo(previous[0], previous[1]);
  ctx.stroke();
}

/**
 * The whole drawing from nothing: paper, the image being drawn over if there
 * is one, then every stroke in order. The paper stays under the image, so
 * one with see-through parts is as opaque as any other drawing.
 */
export function renderDrawing(
  ctx: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  paper: PaperSize = BLANK_PAPER,
  base: CanvasImageSource | null = null,
): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, paper.width, paper.height);
  if (base) ctx.drawImage(base, 0, 0, paper.width, paper.height);
  for (const stroke of strokes) drawStroke(ctx, stroke);
}

/** Above this a PNG is a photograph, not line art, and is saved as one. */
const PNG_BYTES = 1024 * 1024;
const PHOTO_QUALITY = 0.92;

const encoded = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * The canvas as an image file's bytes, or null where the browser made none.
 * A PNG, which keeps a line crisp however often the drawing is reopened,
 * unless it is drawn over a photograph: that as a PNG runs to many megabytes,
 * past what a note takes, so it is a JPEG like the photograph was.
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

/**
 * A note's images with `added` put in: in place of `replaces` where the note
 * still has it, and at the end otherwise, so a drawing made over an image
 * that was meanwhile removed is kept rather than dropped.
 */
export function placeImages(
  images: readonly string[],
  added: readonly string[],
  replaces?: string,
): string[] {
  if (replaces === undefined || !images.includes(replaces)) {
    return [...images, ...added];
  }
  return images.flatMap((image) => (image === replaces ? added : [image]));
}
