// A drawing as the strokes from which it was made, and how they are put on a
// canvas. Kept separate from the pad that collects them. Thus, the geometry can
// be tested without a pointer.

import { carriedImageAlts, type Note } from "@manifesto/shared";
import { MAX_IMAGE_EDGE } from "./shrinkImage.ts";

/** The own size of the drawing, whatever size it shows at: 4 by 3. */
export const DRAWING_WIDTH = 1600;
export const DRAWING_HEIGHT = 1200;

export interface PaperSize {
  width: number;
  height: number;
}

/** The paper of a new drawing. */
export const BLANK_PAPER: PaperSize = {
  width: DRAWING_WIDTH,
  height: DRAWING_HEIGHT,
};

/**
 * The paper for a drawing over an image: the own shape of the image. Its long
 * edge is not shorter than that of a new drawing (a line on a thumbnail would
 * be a row of blocks), and not longer than the size at which an attached image
 * is kept. Null for an image with almost no size.
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

/**
 * How much wider a pen is on `paper` than on a new drawing. Thus, it looks the
 * same width on the screen, whatever the size of the paper.
 */
export function penScale(paper: PaperSize): number {
  return Math.max(paper.width, paper.height) / DRAWING_WIDTH;
}
/**
 * Paper: a drawing is opaque. Thus, it looks the same on a note of any color
 * and in both themes, where transparent ink on a dark note would disappear.
 */
export const PAPER = "#ffffff";

export type Point = readonly [x: number, y: number];

export interface Stroke {
  color: string;
  /** In the own pixels of the drawing. */
  width: number;
  points: Point[];
}

/**
 * Where a pointer is on the drawing, from where it is on the screen. The canvas
 * shows smaller than it is. Thus, both axes scale by that ratio.
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
 * One stroke, as a line through the middle of each pair of points, with the
 * points themselves as the handles of the curve. A hand that moves fast leaves
 * points far apart, and straight segments between them show each corner.
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
  // A tap, or a finger that pushed and never moved. A path with no length draws
  // nothing. Thus, it is a dot with the width of the pen.
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
 * The full drawing from nothing: paper, the image under the drawing if there is
 * one, then each stroke in order. The paper stays under the image. Thus, an
 * image with transparent parts is as opaque as all other drawings.
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

/**
 * The images of a note with `added` put in: in place of `replaces` where the
 * note still has it, and at the end otherwise. Thus, a drawing made over an
 * image that was removed in the meantime is kept, not dropped.
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

/**
 * The descriptions for the answer of `placeImages`. Each image keeps its own,
 * and a drawing made over an image takes the description of that image, which
 * still tells what is under the lines. Empty when no image has one.
 */
export function placedImageAlts(
  before: Pick<Note, "images" | "imageAlts">,
  placed: readonly string[],
  added: readonly string[],
  replaces?: string,
): string[] {
  const alts = carriedImageAlts(before, placed);
  const under =
    replaces === undefined
      ? ""
      : (before.imageAlts?.[before.images.indexOf(replaces)] ?? "");
  if (!under) return alts;
  return placed.map((image, i) =>
    added.includes(image) ? under : (alts[i] ?? ""),
  );
}
