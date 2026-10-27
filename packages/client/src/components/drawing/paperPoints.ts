import {
  CORNERS,
  cornerPoint,
  type Mark,
  type Point,
  type Rect,
} from "#/utils/drawing.ts";
import { fillPicture, floodFill, growArea } from "#/utils/floodFill.ts";
import { type CanvasBox, HANDLE } from "./DrawingOverlay.tsx";

/** Where the paper is on the screen, in client pixels. */
export const shownPaper = (
  at: CanvasBox | null,
  stage: HTMLElement | null,
): CanvasBox | null => {
  if (!at || !stage) return null;
  const around = stage.getBoundingClientRect();
  return { ...at, left: around.left + at.left, top: around.top + at.top };
};

/** Where a pointer is on the paper, also past its edge: a layer goes there. */
export const paperPoint = (
  event: { clientX: number; clientY: number },
  shown: CanvasBox,
  { x, y, width, height }: Rect,
): Point => [
  x + ((event.clientX - shown.left) / shown.width) * width,
  y + ((event.clientY - shown.top) / shown.height) * height,
];

/** True when a point is on the picture, not in the margin around it. */
export const onPicture = ([px, py]: Point, { x, y, width, height }: Rect) =>
  px >= x && py >= y && px < x + width && py < y + height;

/** A distance on the screen, in CSS pixels, as pixels of the paper. */
export const onPaper = (pixels: number, shown: CanvasBox, view: Rect) =>
  (pixels / shown.width) * view.width;

/** The corner handle at a point of the paper, with room for a finger. */
export const cornerAt = (
  bounds: Rect,
  at: Point,
  shown: CanvasBox,
  view: Rect,
) => {
  const reach = onPaper(HANDLE * 1.5, shown, view);
  return (
    CORNERS.find((corner) => {
      const [x, y] = cornerPoint(bounds, corner);
      return Math.abs(at[0] - x) <= reach && Math.abs(at[1] - y) <= reach;
    }) ?? null
  );
};

/** A color of the canvas as `#rrggbb`, which a color field accepts. */
const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * The color of the drawing at a point, as it shows, with all layers and the
 * image under them.
 */
export function colorAt(
  ctx: CanvasRenderingContext2D,
  at: Point,
  { x, y, width, height }: Rect,
): string {
  const [r = 0, g = 0, b = 0] = ctx.getImageData(
    Math.min(width - 1, Math.floor(at[0] - x)),
    Math.min(height - 1, Math.floor(at[1] - y)),
    1,
    1,
  ).data;
  return hex(r, g, b);
}

/**
 * Flood fill: the area around the press that has the color there, as the
 * drawing shows it, in the ink. Hidden layers do not count, as they do not
 * show. Null when there is nothing to fill.
 */
export function fillMark(
  ctx: CanvasRenderingContext2D,
  at: Point,
  shown: Rect,
  ink: string,
  opacity: number,
): Mark | null {
  const { data } = ctx.getImageData(0, 0, shown.width, shown.height);
  const found = floodFill(
    data,
    shown.width,
    shown.height,
    at[0] - shown.x,
    at[1] - shown.y,
  );
  if (!found) return null;
  const area = growArea(found);
  const image = fillPicture(area, ink);
  if (!image) return null;
  const { bounds } = area;
  return {
    image,
    at: { ...bounds, x: bounds.x + shown.x, y: bounds.y + shown.y },
    ...(opacity < 1 ? { opacity } : {}),
  };
}
