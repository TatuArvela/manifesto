import { describe, expect, it } from "vitest";
import {
  CONFETTI,
  CONFETTI_TILE,
  inkHex,
  pictureTextures,
  SCATTER_TILE,
  SCATTERS,
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
