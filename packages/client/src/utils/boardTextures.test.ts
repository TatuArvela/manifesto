import { describe, expect, it } from "vitest";
import {
  CONFETTI,
  CONFETTI_TILE,
  inkHex,
  pictureTextures,
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
    expect(svgOf(textures.hearts).match(/<path /g)).toHaveLength(5);
    for (const name of ["stars", "hearts", "confetti", "sawtooth"] as const) {
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
    // A perfect lattice of this many pieces leaves 27.5px at most.
    expect(widest).toBeLessThan(34);
  });
});
