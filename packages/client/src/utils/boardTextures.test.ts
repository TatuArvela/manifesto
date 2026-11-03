import { describe, expect, it } from "vitest";
import {
  CONFETTI,
  CONFETTI_TILE,
  inkHex,
  paintedSheets,
  pictureTextures,
  SCATTER_TILE,
  SCATTERS,
  SHEET_COUNTS,
  SHEET_SHAPES,
  sheetTextures,
} from "./boardTextures.ts";

function svgOf(url: string): string {
  const match = /^url\("data:image\/svg\+xml,(.*)"\)$/.exec(url);
  return decodeURIComponent(match?.[1] ?? "");
}

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
      "sawtooth",
    ] as const) {
      expect(svgOf(textures[name]), name).not.toMatch(/fill|opacity/);
    }
  });

  it("names a picked colour as the hex the layer is filled with", () => {
    expect(inkHex("white", "#123456")).toBe("#ffffff");
    expect(inkHex("blue", "#123456")).toBe("#3b82f6");
    expect(inkHex("custom", "#123456")).toBe("#123456");
  });

  it("puts nothing in a quoted url() that could close it", () => {
    for (const url of Object.values(pictureTextures())) {
      expect(url.slice(5, -2)).not.toMatch(/["\\\n]/);
    }
  });
});

describe("confetti", () => {
  it("leaves no hole in the tile wider than a little past an even spread", () => {
    const apart = (a: number, b: number) => {
      const d = Math.abs(a - b);
      return Math.min(d, CONFETTI_TILE - d);
    };
    let widest = 0;
    for (let x = 0; x < CONFETTI_TILE; x += 4) {
      for (let y = 0; y < CONFETTI_TILE; y += 4) {
        const nearest = Math.min(
          ...CONFETTI.map((piece) =>
            Math.hypot(apart(x, piece.x), apart(y, piece.y)),
          ),
        );
        widest = Math.max(widest, nearest);
      }
    }
    // A perfect lattice of this many pieces leaves a maximum of 27.5px.
    expect(widest).toBeLessThan(34);
  });
});

describe.each(Object.entries(SCATTERS))("the scattered %s", (name, shapes) => {
  const apart = (a: number, b: number) => {
    const d = Math.abs(a - b);
    return Math.min(d, SCATTER_TILE - d);
  };

  it("keeps every shape clear of the others, across the tile's edges too", () => {
    expect(shapes.length).toBeGreaterThan(60);
    for (const [i, a] of shapes.entries()) {
      for (const b of shapes.slice(i + 1)) {
        const gap = Math.hypot(apart(a.x, b.x), apart(a.y, b.y)) - a.r - b.r;
        expect(gap).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("leaves no bare patch much wider than the largest shape", () => {
    let widest = 0;
    for (let x = 0; x < SCATTER_TILE; x += 4) {
      for (let y = 0; y < SCATTER_TILE; y += 4) {
        const nearest = Math.min(
          ...shapes.map((s) => Math.hypot(apart(x, s.x), apart(y, s.y)) - s.r),
        );
        widest = Math.max(widest, nearest);
      }
    }
    // The scatters leave 21px to 31px. A bare seam, as a scatter kept inside
    // its tile left, would show here first.
    expect(widest).toBeLessThan(34);
  });

  it("draws a shape that crosses an edge again on the far side", () => {
    const svg = svgOf(pictureTextures()[name as keyof typeof SCATTERS]);
    const drawn = svg.match(/<(circle|path) /g) ?? [];
    const crossing = shapes.filter(
      ({ x, y, r }) =>
        x < r || x > SCATTER_TILE - r || y < r || y > SCATTER_TILE - r,
    );
    expect(crossing.length).toBeGreaterThan(0);
    expect(drawn.length).toBeGreaterThan(shapes.length);
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
      const all: readonly unknown[] =
        texture === "confetti"
          ? CONFETTI
          : SCATTERS[texture as keyof typeof SCATTERS];
      const spread: unknown[] = Array.from(
        { length: SHEET_COUNTS[texture as keyof typeof SHEET_SHAPES] },
        (_, k) => shapesOf(k),
      ).flat();
      expect(spread).toHaveLength(all.length);
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
