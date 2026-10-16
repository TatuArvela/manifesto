import { describe, expect, it } from "vitest";
import {
  CONFETTI,
  CONFETTI_TILE,
  LIGHT_THEME_INK,
  pickedInk,
  pictureTextures,
} from "./boardTextures.js";

function svgOf(url: string): string {
  const match = /^url\("data:image\/svg\+xml,(.*)"\)$/.exec(url);
  return decodeURIComponent(match?.[1] ?? "");
}

describe("pictureTextures", () => {
  it("draws the grains in the ink's colour", () => {
    const { paper } = pictureTextures(pickedInk("custom", "#ff8000"));
    expect(svgOf(paper)).toContain(
      "values='0 0 0 0 1 0 0 0 0 0.502 0 0 0 0 0 0 0 0 1.2 -0.3'",
    );
  });

  it("keeps the light theme's grain as it was drawn before", () => {
    const { paper } = pictureTextures(LIGHT_THEME_INK);
    expect(svgOf(paper)).toContain(
      "values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.2 -0.05'",
    );
  });

  it("fills the stars and hearts in the ink, never past fully opaque", () => {
    const { stars, hearts } = pictureTextures({
      rgb: [1, 1, 1],
      strength: 50,
    });
    expect(svgOf(stars)).toContain("fill='rgb(255,255,255)' fill-opacity='1'");
    expect(svgOf(hearts).match(/<path /g)).toHaveLength(5);
  });

  it("draws the sawtooth lighter than the gradient textures' ink", () => {
    const { sawtooth } = pictureTextures(pickedInk("custom", "#ff8000"));
    expect(svgOf(sawtooth)).toContain(
      "fill='rgb(255,128,0)' fill-opacity='0.15'",
    );
  });

  it("puts nothing in a quoted url() that could close it", () => {
    for (const url of Object.values(
      pictureTextures(pickedInk("black", "#000000")),
    )) {
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
