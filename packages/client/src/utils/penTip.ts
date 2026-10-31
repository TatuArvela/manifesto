// How a pen tip lays ink along the points of a stroke.

import type { PenTip, Point, Stroke } from "./drawing.ts";

/** The tilt of the oval tip, as a pen held in a right hand. */
const OVAL_ANGLE = -Math.PI / 4;
/** The oval tip is this much narrower than it is wide. */
const OVAL_RATIO = 0.35;

/**
 * Where a tip that is not round presses its shape: at each point, and between
 * points at steps short enough that the shapes join into a line.
 */
export function stampCenters(points: readonly Point[], width: number): Point[] {
  const step = Math.max(1, width / 6);
  const [first, ...rest] = points;
  if (!first) return [];
  const centers: Point[] = [first];
  let previous = first;
  for (const point of rest) {
    const dx = point[0] - previous[0];
    const dy = point[1] - previous[1];
    const steps = Math.ceil(Math.hypot(dx, dy) / step);
    for (let i = 1; i <= steps; i++) {
      centers.push([
        previous[0] + (dx * i) / steps,
        previous[1] + (dy * i) / steps,
      ]);
    }
    previous = point;
  }
  return centers;
}

/** Adds the shape of the tip, centred on `at`, to the path in progress. */
export function tipPath(
  ctx: CanvasRenderingContext2D | Path2D,
  tip: PenTip,
  width: number,
  at: Point,
): void {
  const half = width / 2;
  if (tip === "square") {
    ctx.rect(at[0] - half, at[1] - half, width, width);
    return;
  }
  // Each shape starts a path of its own at its own edge. A line from the last
  // shape would close it into a wedge.
  if (tip === "oval") {
    ctx.moveTo(
      at[0] + half * Math.cos(OVAL_ANGLE),
      at[1] + half * Math.sin(OVAL_ANGLE),
    );
    ctx.ellipse(
      at[0],
      at[1],
      half,
      half * OVAL_RATIO,
      OVAL_ANGLE,
      0,
      Math.PI * 2,
    );
  } else {
    ctx.moveTo(at[0] + half, at[1]);
    ctx.arc(at[0], at[1], half, 0, Math.PI * 2);
  }
}

/**
 * One stroke. A round tip is a line through the middle of each pair of points,
 * with the points themselves as the handles of the curve. A hand that moves
 * fast leaves points far apart, and straight segments between them show each
 * corner. A different tip is one path of its shapes along the line. One path,
 * filled one time: where the shapes overlap, a transparent ink does not become
 * darker.
 */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
): void {
  const [first, ...rest] = stroke.points;
  if (!first) return;
  const tip = stroke.tip ?? "round";
  ctx.globalCompositeOperation = stroke.erase
    ? "destination-out"
    : "source-over";
  ctx.globalAlpha = stroke.opacity ?? 1;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (tip !== "round") {
    for (const at of stampCenters(stroke.points, stroke.width)) {
      tipPath(ctx, tip, stroke.width, at);
    }
    ctx.fill("nonzero");
  } else if (
    // A tap, or a finger that pushed and never moved. A path with no length
    // draws nothing. Thus, it is a dot with the width of the pen.
    rest.every((point) => point[0] === first[0] && point[1] === first[1])
  ) {
    ctx.arc(first[0], first[1], stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
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
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}
