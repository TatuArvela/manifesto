// A drawing as the strokes it was made of, and how they are put on a canvas.
// Kept apart from the pad that collects them so the geometry can be tested
// without a pointer.

/** The drawing's own size, whatever size it is shown at: 4 by 3. */
export const DRAWING_WIDTH = 1600;
export const DRAWING_HEIGHT = 1200;
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
): Point {
  const x = ((pointer.clientX - shown.left) / shown.width) * DRAWING_WIDTH;
  const y = ((pointer.clientY - shown.top) / shown.height) * DRAWING_HEIGHT;
  return [
    Math.min(DRAWING_WIDTH, Math.max(0, x)),
    Math.min(DRAWING_HEIGHT, Math.max(0, y)),
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

/** The whole drawing from nothing: paper, then every stroke in order. */
export function renderDrawing(
  ctx: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, DRAWING_WIDTH, DRAWING_HEIGHT);
  for (const stroke of strokes) drawStroke(ctx, stroke);
}
