import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOARD_GRADIENT_DIRECTIONS,
  BOARD_GRADIENT_SPEEDS,
  BOARD_TEXTURES,
  type BoardGradientDirection,
} from "#/state/prefParsers.ts";
import { CONFETTI_TILE, SAWTOOTH_TILE } from "#/utils/boardTextures.ts";

// Read from disk. Vitest makes a stylesheet imported in a test blank, also with
// `?raw`.
const css = readFileSync(new URL("./preferences.css", import.meta.url), "utf8");

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
    [...css.slice(start, end).matchAll(/--([a-z-]+):\s*([^;]+);/g)].map(
      ([, name = "", value = ""]) => [name, value],
    ),
  );
}

describe("moving patterns", () => {
  const moving = BOARD_TEXTURES.filter((texture) => texture !== "none");

  function driftOf(texture: string) {
    const rule = ruleOf(
      `.board-texture-tile[data-texture="${texture}"]`,
      "\n  --drift:",
    );
    const [x = 0, y = 0] = (rule.get("drift") ?? "")
      .replace("calc(32px * 1.41421356)", `${32 * Math.SQRT2}px`)
      .split(" ")
      .map((part) => Number.parseFloat(part));
    return {
      x,
      y,
      reach: Number.parseFloat(rule.get("drift-reach") ?? ""),
      sway: Number.parseFloat(rule.get("drift-sway") ?? "0"),
      time: Number.parseFloat(rule.get("drift-time") ?? ""),
    };
  }

  it("gives each pattern a motion on the board and on its tile", () => {
    for (const texture of moving) {
      expect(css).toContain(
        `:root[data-board-texture="${texture}"] .board-frame,\n.board-texture-tile[data-texture="${texture}"] {`,
      );
      expect(driftOf(texture).time).toBeGreaterThan(0);
    }
  });

  // A drift that is not a whole repeat jumps each time that the loop starts.
  it.each([
    "paper",
    "dots",
    "grid",
    "waves",
    "confetti",
    "stars",
    "hearts",
    "bubbles",
  ])("moves %s by a whole tile", (texture) => {
    const [width = 0, height = 0] = tileSize(texture)
      .split(" ")
      .map((part) => Number.parseFloat(part));
    const { x, y } = driftOf(texture);
    expect(width).toBeGreaterThan(0);
    expect(Math.abs(x) % width).toBe(0);
    expect(Math.abs(y) % height).toBe(0);
  });

  it("moves the lines by one line, and the stripes by one stripe and gap", () => {
    expect(tileSize("lines")).toBe("auto");
    expect(css).toContain("transparent 0 27px,\n    #000 27px 28px");
    expect(driftOf("lines").y).toBe(28);
    expect(tileSize("stripes")).toBe("auto");
    expect(css).toContain("#000 0 16px,\n    transparent 16px 32px");
    expect(driftOf("stripes").x * Math.SQRT1_2).toBeCloseTo(32);
  });

  it("moves the sawtooth by one tooth along its row", () => {
    // The tile holds five teeth along a row, which goes across its diagonal.
    const { x, y } = driftOf("sawtooth");
    expect(x).toBeCloseTo(SAWTOOTH_TILE.width / 10);
    expect(y).toBeCloseTo(-SAWTOOTH_TILE.height / 10);
  });

  // Less reach than the move and the sway shows the edge of the layer.
  it.each(moving)("keeps the edge of the %s layer out of view", (texture) => {
    const { x, y, reach, sway } = driftOf(texture);
    expect(reach).toBeGreaterThanOrEqual(Math.abs(x) + sway);
    expect(reach).toBeGreaterThanOrEqual(Math.abs(y));
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
  const TWO_BOARDS = "calc(-200% / 3)";

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
    "rolls %s on a box as wide as it moves, by two boards",
    (direction, [x, y]) => {
      const rule = ruleOf(
        `:root[data-board-gradient-direction="${direction}"]`,
      );
      // The sign of the move, in a line and in a column, from the two ends.
      const offset = (way: number) => (way === 0 ? "0" : TWO_BOARDS);
      const from = `${x > 0 ? offset(x) : "0"} ${y > 0 ? offset(y) : "0"}`;
      const to = `${x < 0 ? offset(x) : "0"} ${y < 0 ? offset(y) : "0"}`;
      expect(rule.get("board-roll-from")).toBe(from);
      expect(rule.get("board-roll-to")).toBe(to);
      expect(rule.get("board-roll-width")).toBe(x === 0 ? "100%" : "300%");
      expect(rule.get("board-roll-height")).toBe(y === 0 ? "100%" : "300%");
      expect(rule.get("board-gradient-way")).toBe(
        `to ${direction.replace("-", " ")}`,
      );
    },
  );

  it("repeats the two colors at the four stops that the box needs", () => {
    const rolled =
      /--board-gradient-rolled:\s*linear-gradient\(([^;]+)\);/.exec(css);
    expect(layers(rolled?.[1] ?? "").map((stop) => stop.trim())).toEqual([
      "var(--board-gradient-way)",
      "var(--board-color, var(--board-page))",
      "var(--board-color-to)",
      "var(--board-color, var(--board-page))",
      "var(--board-color-to)",
    ]);
  });

  it("gives each speed a time", () => {
    for (const speed of BOARD_GRADIENT_SPEEDS) {
      if (speed === "still") continue;
      expect(
        ruleOf(`:root[data-board-roll="${speed}"]`).get("board-roll-time"),
      ).toMatch(/^\d+s$/);
    }
  });
});
