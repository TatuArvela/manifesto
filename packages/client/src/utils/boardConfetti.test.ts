import { describe, expect, it } from "vitest";
import { CONFETTI, CONFETTI_TILE } from "./boardConfetti.ts";

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
