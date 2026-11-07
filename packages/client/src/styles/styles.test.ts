import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOARD_GRADIENT_DIRECTIONS,
  BOARD_TEXTURES,
  type BoardGradientDirection,
} from "#/state/prefParsers.ts";
import { CONFETTI_TILE } from "#/utils/boardConfetti.ts";
import { FRAMES_TILE } from "#/utils/boardFrames.ts";
import { SAWTOOTH_TILE } from "#/utils/boardSawtooth.ts";
import { LEAF_TILE, RAIN_FALL, SCATTER_TILE } from "#/utils/boardScatters.ts";
import {
  DOT_STEP,
  GRID_STEP,
  LINE_STEP,
  LINE_WIDTH,
  PAPER_TILE,
  SHEET_COUNTS,
  WAVE_TILE,
} from "#/utils/boardTextures.ts";

// Read from disk. Vitest makes a stylesheet imported in a test blank, also with
// `?raw`.
const css = ["board-background.css", "board-texture.css", "board-motion.css"]
  .map((name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8"))
  .join("\n");

/** Splits a CSS value on its top-level commas, as a layer list is. */
function layers(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

describe("board textures", () => {
  // The board puts its gradient under the texture with one more size, `100%
  // 100%`. When a texture lists fewer sizes than layers, its list cycles, and
  // the gradient takes the tile size of the texture and repeats.
  const sizes = new Map(
    [...css.matchAll(/--board-texture-([a-z]+)-size:\s*([^;]+);/g)].map(
      ([, name = "", value = ""]) => [name, value],
    ),
  );
  const textures = [
    ...css.matchAll(/--board-texture-([a-z]+):\s*([^;]+);/g),
  ].filter(([, name = ""]) => sizes.has(name));

  it("finds the textures to check", () => {
    expect(textures.map(([, name]) => name)).toContain("grid");
  });

  it.each(textures.map(([, name = "", value = ""]) => [name, value] as const))(
    "lists one size per layer for %s",
    (name, value) => {
      expect(layers(sizes.get(name) ?? "")).toHaveLength(layers(value).length);
    },
  );

  it("tiles confetti at the size it is drawn on", () => {
    expect(sizes.get("confetti")?.trim()).toBe(
      `${CONFETTI_TILE}px ${CONFETTI_TILE}px`,
    );
  });

  it.each([
    ["rain", SCATTER_TILE],
    ["snow", SCATTER_TILE],
    ["leaves", LEAF_TILE],
    ["petals", SCATTER_TILE],
    ["frames", FRAMES_TILE],
  ] as const)("tiles the %s at the size they are drawn on", (texture, tile) => {
    expect(sizes.get(texture)?.trim()).toBe(`${tile}px ${tile}px`);
  });

  it("tiles the sawtooth at the size it is drawn on", () => {
    expect(sizes.get("sawtooth")?.trim()).toBe(
      `${SAWTOOTH_TILE.width}px ${SAWTOOTH_TILE.height}px`,
    );
  });
});

/**
 * The custom properties of the first rule for `selector` whose text starts with
 * `opening`. A selector can have more than one rule.
 */
function ruleOf(selector: string, opening = ""): Map<string, string> {
  const start = css.indexOf(`${selector} {${opening}`);
  const end = css.indexOf("}", start);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return new Map(
    [...css.slice(start, end).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(
      ([, name = "", value = ""]) => [name, value],
    ),
  );
}

describe("moving patterns", () => {
  const moving = BOARD_TEXTURES.filter((texture) => texture !== "none");

  /** The rules of the sheets of a texture: its first, then sheet `nth`. */
  function sheetRule(texture: string, nth?: number): Map<string, string> {
    const selector = `.board-sheets[data-texture="${texture}"] > span`;
    return nth === undefined
      ? ruleOf(selector)
      : ruleOf(`${selector}:nth-child(${nth})`);
  }

  function driftOf(texture: string, nth?: number) {
    const first = sheetRule(texture);
    const rule = nth === undefined ? first : sheetRule(texture, nth);
    const px = (name: string) =>
      Number.parseFloat(
        (rule.get(name) ?? first.get(name) ?? "0px").replace(
          "calc(32px * 1.41421356)",
          `${32 * Math.SQRT2}px`,
        ),
      );
    return { x: px("drift-x"), y: px("drift-y") };
  }

  it("moves each pattern in as many sheets as it is drawn in", () => {
    expect(Object.keys(SHEET_COUNTS).sort()).toEqual([...moving].sort());
    for (const texture of moving) {
      expect(css).toMatch(
        new RegExp(`\\[data-texture="${texture}"\\][^{]*> span`),
      );
    }
  });

  // A drift that is not a whole repeat jumps each time that the loop starts.
  it.each([
    ["confetti", CONFETTI_TILE],
    ["stars", SCATTER_TILE],
    ["hearts", SCATTER_TILE],
    ["bubbles", SCATTER_TILE],
    ["snow", SCATTER_TILE],
    ["leaves", LEAF_TILE],
    ["petals", SCATTER_TILE],
    ["frames", FRAMES_TILE],
  ] as const)("moves %s by a whole tile", (texture, tile) => {
    const { x, y } = driftOf(texture);
    expect(Math.abs(x) + Math.abs(y)).toBe(tile);
    expect(Math.abs(x) % tile).toBe(0);
    expect(Math.abs(y) % tile).toBe(0);
  });

  // A slant that does not end on whole tiles jumps each time that the loop
  // starts.
  it("lets the rain fall on its slant by whole tiles", () => {
    expect(driftOf("rain")).toEqual(RAIN_FALL);
    expect(Math.abs(RAIN_FALL.x) % SCATTER_TILE).toBe(0);
    expect(Math.abs(RAIN_FALL.y) % SCATTER_TILE).toBe(0);
    expect(RAIN_FALL.y).toBeGreaterThan(0);
  });

  // A row that moves farther than the room between two rows crosses one.
  it("moves each row of waves in a small circle, in place", () => {
    const rule = sheetRule("waves");
    expect(driftOf("waves")).toEqual({ x: 0, y: 0 });
    const sway = Number.parseFloat(rule.get("sway") ?? "");
    const bob = Number.parseFloat(rule.get("bob") ?? "");
    expect(sway).toBeGreaterThan(0);
    expect(bob).toBeGreaterThan(0);
    expect(2 * bob).toBeLessThan(WAVE_TILE.height - WAVE_TILE.width / 2);
  });

  it("moves the stripes by one stripe and gap", () => {
    expect(css).toContain("#000 0 16px,\n    transparent 16px 32px");
    expect(driftOf("stripes").x * Math.SQRT1_2).toBeCloseTo(32);
  });

  it("runs the rows of the sawtooth against each other, one tooth each", () => {
    // The tile holds five teeth along a row, which goes across its diagonal.
    const tooth = { x: SAWTOOTH_TILE.width / 10, y: SAWTOOTH_TILE.height / 10 };
    expect(driftOf("sawtooth").x).toBeCloseTo(tooth.x);
    expect(driftOf("sawtooth").y).toBeCloseTo(-tooth.y);
    expect(driftOf("sawtooth", 2).x).toBeCloseTo(-tooth.x);
    expect(driftOf("sawtooth", 2).y).toBeCloseTo(tooth.y);
  });

  // A roll that is not one whole repeat jumps each time that the loop starts.
  it.each([
    ["paper", PAPER_TILE],
    ["dots", DOT_STEP],
    ["grid", GRID_STEP],
    ["lines", LINE_STEP],
  ] as const)(
    "rolls the %s from the top left to the bottom right, one repeat at a time",
    (texture, step) => {
      expect(driftOf(texture)).toEqual({ x: step, y: step });
      expect(SHEET_COUNTS[texture]).toBe(1);
    },
  );

  // The sheet is the still pattern, at the size of the still pattern.
  it("rolls the still pattern of the dots, the grid and the lines", () => {
    for (const texture of ["dots", "grid", "lines"]) {
      expect(css).toContain(
        `--board-sheet-${texture}-0: var(--board-texture-${texture});`,
      );
    }
    for (const texture of ["dots", "grid"]) {
      expect(
        css.slice(
          css.indexOf(`.board-sheets[data-texture="${texture}"] > span {`),
        ),
      ).toMatch(
        new RegExp(
          `^[^}]*mask-size: var\\(--board-texture-${texture}-size\\);`,
        ),
      );
    }
  });

  it("draws the lines of the grid at the width of the lines", () => {
    expect(css).toContain(
      `linear-gradient(#000 ${LINE_WIDTH}px, transparent ${LINE_WIDTH}px),\n    linear-gradient(90deg, #000 ${LINE_WIDTH}px, transparent ${LINE_WIDTH}px);`,
    );
  });

  it("draws the sheets on the repeat of the still pattern", () => {
    expect(tileSize("dots")).toBe(`${DOT_STEP}px ${DOT_STEP}px`);
    expect(tileSize("grid")).toBe(`${GRID_STEP}px ${GRID_STEP}px`);
    expect(css).toContain(
      `transparent 0 ${LINE_STEP - LINE_WIDTH}px,\n    #000 ${LINE_STEP - LINE_WIDTH}px ${LINE_STEP}px`,
    );
    expect(tileSize("waves")).toBe(
      `${WAVE_TILE.width}px ${WAVE_TILE.height}px`,
    );
  });

  // The sheet goes past the board on the side that it comes from. A sign that
  // is the wrong way round shows the edge of the sheet.
  it("puts the reach of a sheet on the side that it comes from", () => {
    const span = ruleOf(".board-sheets > span", "\n  --drift-x: 0px;");
    expect(span.get("drift-x")).toBe("0px");
    const block = css.slice(css.indexOf(".board-sheets > span {"));
    const inset = (side: string) =>
      new RegExp(`\\n  ${side}: ([^;]+);`).exec(block)?.[1];
    expect(inset("top")).toBe(
      "calc((max(var(--drift-y), 0px) + var(--bob)) * -1)",
    );
    expect(inset("left")).toBe(
      "calc((max(var(--drift-x), 0px) + var(--sway)) * -1)",
    );
    expect(inset("bottom")).toBe(
      "calc((max(var(--drift-y) * -1, 0px) + var(--bob)) * -1)",
    );
    expect(inset("right")).toBe(
      "calc((max(var(--drift-x) * -1, 0px) + var(--sway)) * -1)",
    );
  });

  // state/prefs.ts finds the speed of an animation from the start of its name.
  it("names each board animation for the slider that sets its speed", () => {
    const names = [...css.matchAll(/@keyframes (board-[a-z-]+)/g)].map(
      ([, name = ""]) => name,
    );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toMatch(/^board-(roll|sheet)/);
    }
  });

  it("clips the frame only while something moves past it", () => {
    expect(css).not.toMatch(/\.board-frame \{[^}]*overflow/);
    expect(css).toContain(":root[data-board-texture-motion] .board-frame,");
  });
});

/** A size of a texture, from the block of them at the top of the stylesheet. */
function tileSize(texture: string): string {
  const found = new RegExp(`--board-texture-${texture}-size:\\s*([^;]+);`).exec(
    css,
  );
  return (found?.[1] ?? "").split(",")[0]?.trim() ?? "";
}

describe("the rolling gradient", () => {
  const ONE_REPEAT = "var(--board-roll-move)";

  /** Where the layer goes along each axis, as -1, 0 or 1 for each direction. */
  const WAYS: Record<BoardGradientDirection, readonly [number, number]> = {
    top: [0, -1],
    "top-right": [1, -1],
    right: [1, 0],
    "bottom-right": [1, 1],
    bottom: [0, 1],
    "bottom-left": [-1, 1],
    left: [-1, 0],
    "top-left": [-1, -1],
  };

  it("has a direction for each that Settings offers", () => {
    expect(Object.keys(WAYS).sort()).toEqual(
      [...BOARD_GRADIENT_DIRECTIONS].sort(),
    );
  });

  it.each(Object.entries(WAYS))(
    "rolls %s on a box one board longer than a repeat, by one repeat",
    (direction, [x, y]) => {
      const rule = ruleOf(
        `:root[data-board-gradient-direction="${direction}"]`,
      );
      // The sign of the move, in a line and in a column, from the two ends.
      const offset = (way: number) => (way === 0 ? "0" : ONE_REPEAT);
      const from = `${x > 0 ? offset(x) : "0"} ${y > 0 ? offset(y) : "0"}`;
      const to = `${x < 0 ? offset(x) : "0"} ${y < 0 ? offset(y) : "0"}`;
      expect(rule.get("board-roll-from")).toBe(from);
      expect(rule.get("board-roll-to")).toBe(to);
      expect(rule.get("board-roll-width")).toBe(
        x === 0 ? "100%" : "var(--board-roll-long)",
      );
      expect(rule.get("board-roll-height")).toBe(
        y === 0 ? "100%" : "var(--board-roll-long)",
      );
      expect(rule.get("board-gradient-way")).toBe(
        `to ${direction.replace("-", " ")}`,
      );
    },
  );

  // A repeat is `--board-roll-repeat` boards of a box one board longer. Thus,
  // a move of one repeat ends where it started.
  it("repeats the two colors and back, over one repeat of the box", () => {
    const rolled =
      /--board-gradient-rolled:\s*repeating-linear-gradient\(([^;]+)\);/.exec(
        css,
      );
    const part = (percent: number) =>
      `calc(${percent}% * var(--board-roll-repeat) / (1 + var(--board-roll-repeat)))`;
    expect(
      layers(rolled?.[1] ?? "").map((stop) => stop.replace(/\s+/g, " ").trim()),
    ).toEqual([
      "var(--board-gradient-way)",
      "var(--board-color, var(--board-page)) 0%",
      `var(--board-color-to) ${part(50)}`,
      `var(--board-color, var(--board-page)) ${part(100)}`,
    ]);
  });

  it("makes the layer one board longer than a repeat, and moves it one repeat", () => {
    const root = ruleOf(":root", "\n  --board-roll-repeat:");
    const repeat = Number(root.get("board-roll-repeat"));
    expect(repeat).toBeGreaterThanOrEqual(1);
    expect(root.get("board-roll-long")).toBe(
      "calc((1 + var(--board-roll-repeat)) * 100%)",
    );
    expect(root.get("board-roll-move")?.replace(/\s+/g, " ")).toBe(
      "calc( var(--board-roll-repeat) / (1 + var(--board-roll-repeat)) * -100% )",
    );
  });
});
