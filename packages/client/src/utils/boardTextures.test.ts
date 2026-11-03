import { describe, expect, it } from "vitest";
import { svgOf } from "#/test/svgOf.ts";
import { CONFETTI } from "./boardConfetti.ts";
import { FRAMES } from "./boardFrames.ts";
import { SCATTERS } from "./boardScatters.ts";
import {
  paintedSheets,
  pictureTextures,
  SHEET_COUNTS,
  SHEET_SHAPES,
  sheetTextures,
} from "./boardTextures.ts";

describe("pictureTextures", () => {
  it("draws the grain as alpha alone, from nothing to fully drawn", () => {
    const { paper } = pictureTextures();
    expect(svgOf(paper)).toContain(
      "values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2 -0.5'",
    );
  });

  it("draws every shape opaque, leaving colour and opacity to the layer", () => {
    const textures = pictureTextures();
    for (const name of [
      "stars",
      "hearts",
      "confetti",
      "bubbles",
      "rain",
      "snow",
      "leaves",
      "petals",
      "frames",
      "sawtooth",
    ] as const) {
      expect(svgOf(textures[name]), name).not.toMatch(/fill|opacity/);
    }
  });

  it("puts nothing in a quoted url() that could close it", () => {
    for (const url of Object.values(pictureTextures())) {
      expect(url.slice(5, -2)).not.toMatch(/["\\\n]/);
    }
  });
});

describe("the sheets of the moving patterns", () => {
  const drawn = sheetTextures();

  it("draws as many sheets as each pattern moves in", () => {
    for (const [texture, images] of Object.entries(drawn)) {
      expect(images, texture).toHaveLength(
        SHEET_COUNTS[texture as keyof typeof drawn],
      );
    }
  });

  // A shape on no sheet is missing from the moving pattern. A shape on two is
  // drawn twice.
  it.each(Object.entries(SHEET_SHAPES))(
    "puts each of the %s on exactly one sheet",
    (texture, shapesOf) => {
      const all: readonly unknown[] | undefined = {
        confetti: CONFETTI,
        frames: FRAMES,
        ...SCATTERS,
      }[texture];
      expect(all, texture).toBeDefined();
      const spread: unknown[] = Array.from(
        { length: SHEET_COUNTS[texture as keyof typeof SHEET_SHAPES] },
        (_, k) => shapesOf(k),
      ).flat();
      expect(spread).toHaveLength(all?.length ?? 0);
      expect(new Set(spread)).toEqual(new Set(all));
    },
  );

  it("splits the rows of the waves and of the sawtooth between sheets", () => {
    const rows = (url: string) =>
      (svgOf(url).match(/<(path|use) /g) ?? []).length;
    // Row 0 is on both edges of its tile, each with its own half.
    expect(drawn.waves.map(rows)).toEqual([2, 1, 1, 1, 1, 1, 1, 1]);
    const heights = drawn.waves.map(
      (url) => /M-?[\d.]+ ([\d.]+)A/.exec(svgOf(url))?.[1],
    );
    expect(new Set(heights).size).toBe(drawn.waves.length);
    const sawtooth = drawn.sawtooth.map(rows);
    const still = rows(pictureTextures().sawtooth);
    // The one row path of the defs, and the rows that use it.
    expect((sawtooth[0] ?? 0) + (sawtooth[1] ?? 0) - 2).toBe(still - 1);
  });
});

describe("the sheets of the painter", () => {
  const painted = paintedSheets();

  it.each(Object.entries(painted))(
    "draws each sheet of the %s on its tile",
    (texture, { width, height, images }) => {
      expect(images).toHaveLength(
        SHEET_COUNTS[texture as keyof typeof SHEET_COUNTS],
      );
      for (const image of images) {
        expect(image.startsWith("data:image/svg+xml,")).toBe(true);
        const svg = decodeURIComponent(
          image.slice("data:image/svg+xml,".length),
        );
        const size = /width='([\d.]+)' height='([\d.]+)'/.exec(svg);
        expect(Number(size?.[1])).toBeCloseTo(width, 2);
        expect(Number(size?.[2])).toBeCloseTo(height, 2);
      }
    },
  );
});
