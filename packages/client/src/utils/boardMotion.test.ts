import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOARD_FRAME_RATE,
  easeInOut,
  frameDue,
  frameRateOf,
  type PerSheet,
  ROLL_REPEAT_BOARDS,
  ROLL_SECONDS_PER_BOARD,
  type RollWay,
  rollLine,
  rollMix,
  rollShift,
  SHEET_PLANS,
  sheetState,
  sheetStates,
} from "./boardMotion.ts";
import { type MovingTexture, SHEET_COUNTS } from "./boardTextures.ts";

// Read from disk. Vitest makes a stylesheet imported in a test blank.
const css = ["board-background.css", "board-texture.css", "board-motion.css"]
  .map((name) =>
    readFileSync(new URL(`../styles/${name}`, import.meta.url), "utf8"),
  )
  .join("\n");

/** The text of the first rule for `selector` whose text starts with `opening`. */
function block(selector: string, opening = ""): string {
  const start = css.indexOf(`${selector} {${opening}`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

/** A time for each sheet, as the stylesheet writes it. */
function seconds([base, step]: PerSheet): string {
  return step === 0 ? `${base}s` : `calc(${base}s + var(--k) * ${step}s)`;
}

/** A delay for each sheet, as the stylesheet writes it. */
function delay([base, step]: PerSheet): string {
  return base === 0
    ? `calc(var(--k) * ${step}s)`
    : `calc((var(--k) - ${-base / step}) * ${step}s)`;
}

function px(n: number): string {
  return n === 32 * Math.SQRT2 ? "calc(32px * 1.41421356)" : `${n}px`;
}

/** What the rule of the sheets of `texture` must contain, from its plan. */
function expected(texture: MovingTexture): string[] {
  const { drift, sway, orbit, glint } = SHEET_PLANS[texture];
  const parts: string[] = [];
  if (drift) {
    parts.push(`board-sheet-drift ${seconds(drift.seconds)} linear infinite`);
    if (drift.x !== 0) parts.push(`--drift-x: ${px(drift.x)};`);
    if (drift.y !== 0) parts.push(`--drift-y: ${px(drift.y)};`);
  }
  if (sway) {
    parts.push(
      `--sway: ${sway.by}px;`,
      `board-sheet-sway ${seconds(sway.seconds)} ease-in-out infinite alternate`,
      delay(sway.delay),
    );
  }
  if (orbit) {
    const start = delay(orbit.delay);
    parts.push(
      `--sway: ${orbit.across}px;`,
      `--bob: ${orbit.up}px;`,
      `board-sheet-orbit-x ${orbit.seconds}s ease-in-out infinite`,
      `board-sheet-orbit-y ${orbit.seconds}s ease-in-out infinite`,
      `${start}, ${start.slice(0, -1)} - ${orbit.seconds / 4}s)`,
    );
  }
  if (glint) {
    parts.push(
      `--glint-low: ${glint.low};`,
      `board-sheet-glint ${seconds(glint.seconds)} ease-in-out infinite`,
      delay(glint.delay),
    );
  }
  return parts;
}

const textures = Object.keys(SHEET_COUNTS) as MovingTexture[];

describe("the plans of the painter and the keyframes of the sheets", () => {
  it("has a plan for each moving pattern", () => {
    expect(Object.keys(SHEET_PLANS).sort()).toEqual([...textures].sort());
  });

  it.each(textures)("moves the %s as the stylesheet does", (texture) => {
    const rule = block(`.board-sheets[data-texture="${texture}"] > span`);
    for (const part of expected(texture)) {
      expect(rule, texture).toContain(part);
    }
  });

  it("runs every other row of the sawtooth the other way", () => {
    const drift = SHEET_PLANS.sawtooth.drift;
    expect(drift?.against).toBe(true);
    const second = block(
      '.board-sheets[data-texture="sawtooth"] > span:nth-child(2)',
    );
    expect(second).toContain(`--drift-x: ${-(drift?.x ?? 0)}px;`);
    expect(second).toContain(`--drift-y: ${-(drift?.y ?? 0)}px;`);
  });
});

describe("the motion of the sheets", () => {
  it("eases in and out as CSS does", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.25)).toBeCloseTo(0.13, 2);
    expect(easeInOut(0.75)).toBeCloseTo(0.87, 2);
    for (let x = 0; x < 1; x += 0.05) {
      expect(easeInOut(x + 0.05)).toBeGreaterThanOrEqual(easeInOut(x));
    }
  });

  it("drifts by a part of its move for each part of its time", () => {
    // The stripes only drift.
    const drift = SHEET_PLANS.stripes.drift;
    const time = drift?.seconds[0] ?? 0;
    expect(sheetState("stripes", 0, 0).x).toBe(0);
    expect(sheetState("stripes", 0, time / 2).x).toBeCloseTo(
      (drift?.x ?? 0) / 2,
    );
    // One whole move later, it is where it started.
    expect(sheetState("stripes", 0, time).x).toBeCloseTo(0);
  });

  it("runs every other row of the sawtooth the other way", () => {
    const first = sheetState("sawtooth", 0, 2);
    const second = sheetState("sawtooth", 1, 2);
    expect(second.x).toBeCloseTo(-first.x);
    expect(second.y).toBeCloseTo(-first.y);
  });

  it("sways from one side to the other and back", () => {
    // The first sheet of the confetti has no delay. Its drift is down only.
    const sway = SHEET_PLANS.confetti.sway;
    const time = sway?.seconds[0] ?? 0;
    const by = sway?.by ?? 0;
    expect(sheetState("confetti", 0, 0).x).toBeCloseTo(-by);
    expect(sheetState("confetti", 0, time).x).toBeCloseTo(by);
    expect(sheetState("confetti", 0, 2 * time).x).toBeCloseTo(-by);
    expect(sheetState("confetti", 0, time / 2).x).toBeCloseTo(0);
  });

  it("moves each row of waves in a circle, inside its sway and bob", () => {
    const orbit = SHEET_PLANS.waves.orbit;
    for (let t = 0; t < 8; t += 0.1) {
      for (const state of sheetStates("waves", t)) {
        expect(Math.abs(state.x)).toBeLessThanOrEqual(orbit?.across ?? 0);
        expect(Math.abs(state.y)).toBeLessThanOrEqual(orbit?.up ?? 0);
      }
    }
    // Across is at its middle when up and down is at an end: a circle.
    const quarter = (orbit?.seconds ?? 0) / 4;
    const state = sheetState("waves", 0, quarter);
    expect(Math.abs(state.x) + Math.abs(state.y)).toBeGreaterThan(0);
  });

  it("twinkles each star sheet between its low and fully drawn", () => {
    const glint = SHEET_PLANS.stars.glint;
    const time = glint?.seconds[0] ?? 0;
    expect(sheetState("stars", 0, 0).alpha).toBeCloseTo(glint?.low ?? 0);
    expect(sheetState("stars", 0, time / 2).alpha).toBeCloseTo(1);
  });

  it("rolls the paper, the dots, the grid and the lines along the diagonal", () => {
    for (const texture of ["paper", "dots", "grid", "lines"] as const) {
      const state = sheetState(texture, 0, 1);
      expect(state.x, texture).toBeGreaterThan(0);
      expect(state.y, texture).toBeCloseTo(state.x);
      expect(state.alpha, texture).toBe(1);
    }
  });

  it("gives a state for each sheet", () => {
    for (const texture of textures) {
      expect(sheetStates(texture, 1)).toHaveLength(SHEET_COUNTS[texture]);
    }
  });
});

describe("frameDue", () => {
  /** The draws in one second of a screen at `hz`, at no more than `fps`. */
  function drawsInASecond(hz: number, fps: number): number {
    let lastDraw: number | null = null;
    let draws = 0;
    for (let frame = 0; frame < hz; frame++) {
      const due = frameDue((frame * 1000) / hz, lastDraw, fps);
      if (due === null) continue;
      lastDraw = due;
      draws++;
    }
    return draws;
  }

  it("draws on the first frame", () => {
    expect(frameDue(1234, null, 5)).toBe(1234);
  });

  it("draws at the chosen rate on screens of each rate", () => {
    expect(drawsInASecond(60, 60)).toBe(60);
    expect(drawsInASecond(60, 30)).toBe(30);
    expect(drawsInASecond(60, 25)).toBe(25);
    expect(drawsInASecond(60, 14)).toBe(14);
    expect(drawsInASecond(120, 14)).toBe(14);
    expect(drawsInASecond(60, 5)).toBe(5);
    expect(drawsInASecond(120, 60)).toBe(60);
    expect(drawsInASecond(120, 30)).toBe(30);
    expect(drawsInASecond(144, 60)).toBe(60);
  });

  it("never draws faster than the screen", () => {
    expect(drawsInASecond(30, 60)).toBe(30);
  });

  // A frame that comes a little early is not skipped.
  it("draws on a frame that is a little early", () => {
    expect(frameDue(1032, 1000, 30)).toBeCloseTo(1033.33);
  });

  it("counts again from now after a long gap", () => {
    expect(frameDue(2000, 1000, 30)).toBe(2000);
  });
});

describe("frameRateOf", () => {
  it("draws most patterns, and a board with no pattern, at the board rate", () => {
    expect(frameRateOf(null)).toBe(BOARD_FRAME_RATE);
    expect(frameRateOf("snow")).toBe(BOARD_FRAME_RATE);
  });

  // At the board rate, a drop on the near sheet of the rain jumps 6px in one
  // frame.
  it("draws the rain at its own rate, so that a drop moves 3px at most", () => {
    const drift = SHEET_PLANS.rain.drift;
    const seconds = drift?.seconds[0] ?? 0;
    const fastest = Math.hypot(drift?.x ?? 0, drift?.y ?? 0) / seconds;
    expect(fastest / frameRateOf("rain")).toBeLessThanOrEqual(3);
  });
});

describe("the rolling gradient of the painter", () => {
  const WAYS: readonly RollWay[] = [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
  ];

  /** Where a point is along the line, from 0 at its start to 1 at its end. */
  function along(way: RollWay, w: number, h: number, x: number, y: number) {
    const { dir, length } = rollLine(way, w, h);
    return ((x - w / 2) * dir[0] + (y - h / 2) * dir[1]) / length + 0.5;
  }

  // As a CSS `linear-gradient` to a side or a corner, on a board of any shape.
  it.each(WAYS)("goes from end to end of the board toward %s, %s", (x, y) => {
    const [w, h] = [1200, 700];
    const start = [((1 - x) / 2) * w, ((1 - y) / 2) * h] as const;
    const end = [((1 + x) / 2) * w, ((1 + y) / 2) * h] as const;
    expect(along([x, y], w, h, ...start)).toBeCloseTo(0);
    expect(along([x, y], w, h, ...end)).toBeCloseTo(1);
    if (x !== 0 && y !== 0) {
      // The middle of the fade goes through the two other corners.
      expect(along([x, y], w, h, end[0], start[1])).toBeCloseTo(0.5);
      expect(along([x, y], w, h, start[0], end[1])).toBeCloseTo(0.5);
    }
  });

  it("starts from the first color, and goes to the second and back", () => {
    expect(rollMix(0, 0)).toBe(0);
    expect(rollMix(1, 0)).toBeCloseTo(2 / ROLL_REPEAT_BOARDS);
    expect(rollMix(ROLL_REPEAT_BOARDS / 2, 0)).toBe(1);
    // It moves toward the end of the line.
    expect(rollMix(1, 1)).toBe(rollMix(0, 0));
  });

  it("moves one board in its time, and ends a repeat where it started", () => {
    expect(rollShift(ROLL_SECONDS_PER_BOARD)).toBeCloseTo(1);
    const repeat = ROLL_REPEAT_BOARDS * ROLL_SECONDS_PER_BOARD;
    expect(rollShift(repeat)).toBeCloseTo(0);
    expect(rollShift(1000 * repeat + 7)).toBeCloseTo(rollShift(7));
  });

  // The preview in Settings and a board without WebGL roll with CSS.
  it("has the repeat and the time of the CSS roll", () => {
    expect(css).toContain(`--board-roll-repeat: ${ROLL_REPEAT_BOARDS};`);
    expect(css).toContain(
      `animation: board-roll calc(var(--board-roll-repeat) * ${ROLL_SECONDS_PER_BOARD}s)`,
    );
  });
});
