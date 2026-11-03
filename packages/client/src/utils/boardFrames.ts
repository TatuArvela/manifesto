import { across, dataUrl, round, seeded } from "./boardSvg.ts";

/**
 * The frames of the board pattern: rounded rings of many sizes, over each
 * other, each with a band for its line and its hole a little off its centre.
 */

/** The tile the frames float on, in px: wider, because a frame is large. */
export const FRAMES_TILE = 480;

/**
 * A rounded frame: its centre, its size, its corner, the width of its line,
 * and how far its hole is off the centre of the frame.
 */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
  corner: number;
  line: number;
  hole: { x: number; y: number };
}

/**
 * The thinnest side of a frame, in px. As the lines, a thinner mark flickers
 * as it moves on a screen mode that macOS scales.
 */
export const FRAME_THINNEST = 1.5;

/**
 * Frames that float over each other, as rounded outlines of many sizes and
 * line widths. They cross, which is the look, but their centres spread as the
 * confetti does: each goes in the best of an increasing number of random
 * places, the place farthest from the centres already down, measured around
 * the edges of the tile. Thus, no part of the tile is crowded or bare. They are
 * sorted largest first, as the bubbles are. Thus, the near sheet has the
 * largest frames.
 */
function scatterFrames(count: number): Frame[] {
  const random = seeded(20261107);
  const centres: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    let best = { x: 0, y: 0, room: -1 };
    for (let tries = 0; tries < 3 * i + 1; tries++) {
      const x = random() * FRAMES_TILE;
      const y = random() * FRAMES_TILE;
      let room = Number.POSITIVE_INFINITY;
      for (const other of centres) {
        room = Math.min(
          room,
          Math.hypot(
            across(x, other.x, FRAMES_TILE),
            across(y, other.y, FRAMES_TILE),
          ),
        );
      }
      if (room > best.room) best = { x, y, room };
    }
    centres.push({ x: best.x, y: best.y });
  }
  return centres
    .map(({ x, y }) => {
      const width = 50 + 120 * random() ** 1.4;
      const height = width * (0.7 + 0.6 * random());
      // A band, not a stroke: 7% to 13% of the short side, to the nearest
      // half px. Thus, a large frame has a thick line and a small frame a thin
      // one, as on the patterns of rounded squares of the 1970s.
      const line = Math.max(
        2,
        Math.round(Math.min(width, height) * (0.07 + 0.06 * random()) * 2) / 2,
      );
      // The hole moves off the centre, in any direction, by 15% to 45% of the
      // line. Thus, the line is up to about twice as thick on one side as on
      // the other, and its thin side is still a band, never under
      // `FRAME_THINNEST`.
      const off = Math.min(
        line * (0.15 + 0.3 * random()),
        line - FRAME_THINNEST,
      );
      const toward = random() * 2 * Math.PI;
      return {
        x: round(x),
        y: round(y),
        width: round(width),
        height: round(height),
        corner: round(Math.min(width, height) * (0.18 + 0.1 * random())),
        line,
        hole: {
          x: round(off * Math.cos(toward)),
          y: round(off * Math.sin(toward)),
        },
      };
    })
    .sort((a, b) => b.width * b.height - a.width * a.height);
}

/** Exported for their test, which holds each frame on exactly one sheet. */
export const FRAMES: readonly Frame[] = scatterFrames(24);

/**
 * A rounded rectangle as a closed path, clockwise or the other way. A ring is
 * one of each: the nonzero fill leaves the inner one empty, and where two rings
 * cross, it joins them.
 */
function roundedRect(
  x: number,
  y: number,
  width: number,
  height: number,
  corner: number,
  clockwise: boolean,
): string {
  const r = round(Math.max(0, Math.min(corner, width / 2, height / 2)));
  const left = round(x);
  const top = round(y);
  const right = round(x + width);
  const bottom = round(y + height);
  const arc = (toX: number, toY: number) =>
    `A${r} ${r} 0 0 ${clockwise ? 1 : 0} ${round(toX)} ${round(toY)}`;
  return clockwise
    ? `M${round(left + r)} ${top}H${round(right - r)}${arc(right, top + r)}V${round(bottom - r)}${arc(right - r, bottom)}H${round(left + r)}${arc(left, bottom - r)}V${round(top + r)}${arc(left + r, top)}Z`
    : `M${round(left + r)} ${top}${arc(left, top + r)}V${round(bottom - r)}${arc(left + r, bottom)}H${round(right - r)}${arc(right, bottom - r)}V${round(top + r)}${arc(right - r, top)}Z`;
}

/**
 * A frame as a ring, the line centred on its outline, and the hole moved off
 * the centre by `hole`.
 */
function frameRing(frame: Frame, x: number, y: number): string {
  const { width, height, corner, line, hole } = frame;
  const half = line / 2;
  const outer = roundedRect(
    x - width / 2 - half,
    y - height / 2 - half,
    width + line,
    height + line,
    corner + half,
    true,
  );
  const inner = roundedRect(
    x - width / 2 + half + hole.x,
    y - height / 2 + half + hole.y,
    width - line,
    height - line,
    corner - half,
    false,
  );
  return `<path d='${outer}${inner}'/>`;
}

/**
 * The frames as SVG, each again past each edge that it crosses. Thus, it is
 * never cut.
 */
export function drawFrames(shown: readonly Frame[] = FRAMES): string {
  const drawn = shown.flatMap((frame) => {
    const reachX = frame.width / 2 + frame.line;
    const reachY = frame.height / 2 + frame.line;
    const xs = [frame.x];
    const ys = [frame.y];
    if (frame.x < reachX) xs.push(frame.x + FRAMES_TILE);
    if (frame.x > FRAMES_TILE - reachX) xs.push(frame.x - FRAMES_TILE);
    if (frame.y < reachY) ys.push(frame.y + FRAMES_TILE);
    if (frame.y > FRAMES_TILE - reachY) ys.push(frame.y - FRAMES_TILE);
    return xs.flatMap((x) => ys.map((y) => frameRing(frame, x, y)));
  });
  return dataUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${FRAMES_TILE}' height='${FRAMES_TILE}'>${drawn.join("")}</svg>`,
  );
}
