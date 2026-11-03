import {
  LEAF_TILE,
  type MovingTexture,
  RAIN_FALL,
  SHEET_COUNTS,
} from "./boardTextures.ts";

/**
 * The motion of each sheet of a moving pattern, as numbers. The board painter
 * (boardPainter.worker.ts) reads it on each frame. It is the same motion as the
 * keyframes of `.board-sheets` in preferences.css, which the tiles in Settings
 * and the board without WebGL still play. boardMotion.test.ts holds the two
 * equal.
 *
 * A time is in seconds, at a speed of 100%. `[base, step]` is a value for sheet
 * `k` of `base + k * step`, as `calc(base + var(--k) * step)` in the
 * stylesheet.
 */
export type PerSheet = readonly [base: number, step: number];

export interface SheetPlan {
  /**
   * A move of one whole tile, linear, which starts again. With `against`, every
   * other sheet goes the other way.
   */
  readonly drift?: {
    readonly x: number;
    readonly y: number;
    readonly seconds: PerSheet;
    readonly against?: true;
  };
  /** Side to side, and back, with an ease-in-out at each end. */
  readonly sway?: {
    readonly by: number;
    readonly seconds: PerSheet;
    readonly delay: PerSheet;
  };
  /**
   * A circle: across, and up and down a quarter of a turn later. Each swing
   * eases at its ends.
   */
  readonly orbit?: {
    readonly across: number;
    readonly up: number;
    readonly seconds: number;
    readonly delay: PerSheet;
  };
  /** An opacity from `low` to fully drawn and back. */
  readonly glint?: {
    readonly low: number;
    readonly seconds: PerSheet;
    readonly delay: PerSheet;
  };
  /**
   * The most frames each second that the painter draws this pattern with, in
   * place of `BOARD_FRAME_RATE`. Only for a pattern that moves too far in one
   * frame at that rate to look smooth.
   */
  readonly frameRate?: number;
}

export const SHEET_PLANS: Record<MovingTexture, SheetPlan> = {
  // On a screen mode that macOS scales (not half of the panel), a line of 1px
  // flickers as it moves: it crosses the pixels of the panel, and becomes
  // thinner and thicker. The page cannot know the pixels of the panel. Soft
  // edges changed the look, and steps of 2px looked slow and jerky. Lines of
  // 2px (`LINE_WIDTH` in boardTextures.ts) fixed it for the lines and the grid.
  paper: { drift: { x: 160, y: 160, seconds: [40, 0] } },
  dots: { drift: { x: 22, y: 22, seconds: [5, 0] } },
  grid: { drift: { x: 24, y: 24, seconds: [6, 0] } },
  lines: { drift: { x: 28, y: 28, seconds: [7, 0] } },
  waves: { orbit: { across: 6, up: 4, seconds: 4, delay: [-4, 0.5] } },
  confetti: {
    drift: { x: 0, y: 320, seconds: [22, 9] },
    sway: { by: 12, seconds: [3.1, 1.1], delay: [0, -1.7] },
  },
  hearts: {
    drift: { x: 0, y: -360, seconds: [34, 12] },
    sway: { by: 10, seconds: [4, 1.3], delay: [0, -2.1] },
  },
  bubbles: {
    drift: { x: 0, y: -360, seconds: [18, 8] },
    sway: { by: 8, seconds: [2.4, 0.8], delay: [0, -1.1] },
  },
  stars: {
    drift: { x: -360, y: 0, seconds: [96, 0] },
    glint: { low: 0.25, seconds: [2.6, 0.9], delay: [0, -1.3] },
  },
  // Rain falls about ten times as fast as the other patterns move. At 14
  // frames each second, a drop on the near sheet jumps 6px in each frame.
  rain: {
    drift: { x: RAIN_FALL.x, y: RAIN_FALL.y, seconds: [17, 8] },
    frameRate: 30,
  },
  snow: {
    drift: { x: 0, y: 360, seconds: [36, 14] },
    sway: { by: 14, seconds: [5, 1.6], delay: [0, -2.3] },
  },
  leaves: {
    drift: { x: 0, y: LEAF_TILE, seconds: [36, 12] },
    sway: { by: 20, seconds: [4.2, 1.4], delay: [0, -1.9] },
  },
  petals: {
    drift: { x: 0, y: 360, seconds: [24, 9] },
    sway: { by: 16, seconds: [3.4, 1.2], delay: [0, -1.5] },
  },
  stripes: { drift: { x: 32 * Math.SQRT2, y: 0, seconds: [8, 0] } },
  frames: {
    drift: { x: 0, y: -480, seconds: [60, 30] },
    sway: { by: 8, seconds: [7, 2.3], delay: [0, -3.1] },
  },
  sawtooth: {
    drift: { x: 28.6, y: -28.6, seconds: [8, 0], against: true },
  },
};

/** Where sheet `k` is at a time: its move and its opacity. */
export interface SheetState {
  x: number;
  y: number;
  alpha: number;
}

function at([base, step]: PerSheet, k: number): number {
  return base + k * step;
}

/** The part of the loop that is complete, from 0 up to 1. */
function phase(t: number, seconds: number, delay = 0): number {
  const u = (t - delay) / seconds;
  return u - Math.floor(u);
}

// cubic-bezier(0.42, 0, 0.58, 1), the CSS `ease-in-out`.
const bezier = (t: number, a: number, b: number) =>
  3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
const slope = (t: number, a: number, b: number) =>
  3 * (1 - t) * (1 - t) * a + 6 * (1 - t) * t * (b - a) + 3 * t * t * (1 - b);

/** The CSS `ease-in-out` at `x`, from 0 to 1. */
export function easeInOut(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const d = slope(t, 0.42, 0.58);
    if (d < 1e-6) break;
    t = Math.min(1, Math.max(0, t - (bezier(t, 0.42, 0.58) - x) / d));
  }
  return bezier(t, 0, 1);
}

/** Up from 0 to 1 over the first half, and down again, eased in each half. */
function rise(f: number): number {
  return f < 0.5 ? easeInOut(2 * f) : 1 - easeInOut(2 * f - 1);
}

/** The state of sheet `k` of `texture` at time `t`. */
export function sheetState(
  texture: MovingTexture,
  k: number,
  t: number,
): SheetState {
  const plan = SHEET_PLANS[texture];
  const state: SheetState = { x: 0, y: 0, alpha: 1 };
  const { drift, sway, orbit, glint } = plan;
  if (drift) {
    const f = phase(t, at(drift.seconds, k));
    const sign = drift.against && k % 2 === 1 ? -1 : 1;
    state.x += f * drift.x * sign;
    state.y += f * drift.y * sign;
  }
  if (sway) {
    // `alternate`: every other loop goes back.
    const u = (t - at(sway.delay, k)) / at(sway.seconds, k);
    const loop = Math.floor(u);
    const f = loop % 2 === 0 ? u - loop : 1 - (u - loop);
    state.x += sway.by * (2 * easeInOut(f) - 1);
  }
  if (orbit) {
    const delay = at(orbit.delay, k);
    const across = rise(phase(t, orbit.seconds, delay));
    const up = rise(phase(t, orbit.seconds, delay - orbit.seconds / 4));
    state.x += orbit.across * (2 * across - 1);
    state.y += orbit.up * (2 * up - 1);
  }
  if (glint) {
    const f = phase(t, at(glint.seconds, k), at(glint.delay, k));
    state.alpha = glint.low + (1 - glint.low) * rise(f);
  }
  return state;
}

/** The states of all the sheets of `texture` at time `t`. */
export function sheetStates(texture: MovingTexture, t: number): SheetState[] {
  return Array.from({ length: SHEET_COUNTS[texture] }, (_, k) =>
    sheetState(texture, k, t),
  );
}

/**
 * The most frames each second that the board painter draws. Each frame costs
 * the GPU a pass over the full board, and the screen a new frame. The patterns
 * move slowly: at 100%, most move 4 to 6 px each second, less than half a px
 * each frame at this rate. Thus, more frames look almost the same, and cost
 * more. A screen of 120 Hz would otherwise get 120 draws each second.
 */
export const BOARD_FRAME_RATE = 14;

/** The most frames each second that the painter draws `texture` with. */
export function frameRateOf(texture: MovingTexture | null): number {
  return (texture ? SHEET_PLANS[texture].frameRate : null) ?? BOARD_FRAME_RATE;
}

/**
 * A frame of the screen comes a little early or late. A draw that is due within
 * this time is not skipped.
 */
const FRAME_SLACK_MS = 2;

/**
 * If the board painter draws on the frame of the screen at `now` (ms), at no
 * more than `fps` draws each second. It returns the time to count the next
 * draw from, or null to skip this frame. The next draw counts from the time
 * when this one was due, not from `now`. Thus, 25 fps on a screen of 60 Hz
 * gives 25 draws each second, not 20. After a long gap (a slow frame), it
 * counts from `now`.
 */
export function frameDue(
  now: number,
  lastDraw: number | null,
  fps: number,
): number | null {
  if (lastDraw === null) return now;
  const interval = 1000 / fps;
  const gap = now - lastDraw;
  if (gap < interval - FRAME_SLACK_MS) return null;
  return gap < 2 * interval ? lastDraw + interval : now;
}

/**
 * The rolling gradient, as the board painter draws it. One repeat goes from
 * the first color to the second and back, and is this many boards long along
 * the gradient line of the board. Thus, the board shows half of one fade at a
 * time, and the turns at each color pass slowly. `--board-roll-repeat` in
 * preferences.css is the same number, for the preview in Settings and a board
 * that rolls with CSS.
 */
export const ROLL_REPEAT_BOARDS = 4;

/** The time in which the gradient moves one board along its line, at 100%. */
export const ROLL_SECONDS_PER_BOARD = 30;

/**
 * Where the gradient goes, as -1, 0 or 1 across and down: `[1, 1]` is to the
 * bottom right.
 */
export type RollWay = readonly [x: -1 | 0 | 1, y: -1 | 0 | 1];

/**
 * The gradient line of a board of `width` by `height`, as a CSS
 * `linear-gradient` makes it: a unit vector, with y down, and the length of
 * the line. For a corner, the line is at a right angle to the diagonal between
 * the two other corners. Thus, the middle of the fade goes through those
 * corners, on a board of any shape.
 */
export function rollLine(
  [x, y]: RollWay,
  width: number,
  height: number,
): { dir: readonly [number, number]; length: number } {
  const across = x * height;
  const down = y * width;
  const norm = Math.hypot(across, down) || 1;
  const dir = [across / norm, down / norm] as const;
  return {
    dir,
    length: Math.abs(width * dir[0]) + Math.abs(height * dir[1]),
  };
}

/**
 * How far the gradient moved along its line at time `t` (seconds at 100%), in
 * boards, inside one repeat. Thus, the shader keeps its precision.
 */
export function rollShift(t: number): number {
  const boards = t / ROLL_SECONDS_PER_BOARD;
  return boards - Math.floor(boards / ROLL_REPEAT_BOARDS) * ROLL_REPEAT_BOARDS;
}

/**
 * The part of the second color at `along` (0 at the start of the line of the
 * board, 1 at its end) when the gradient moved `shift` boards, from 0 to 1.
 * The shader in boardGl.ts does the same.
 */
export function rollMix(along: number, shift: number): number {
  const u = (along - shift) / ROLL_REPEAT_BOARDS;
  const q = u - Math.floor(u);
  return 1 - Math.abs(2 * q - 1);
}
