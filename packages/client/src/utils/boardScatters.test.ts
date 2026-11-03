import { describe, expect, it } from "vitest";
import { svgOf } from "#/test/svgOf.ts";
import {
  drawScatter,
  SCATTER_TILE,
  SCATTERS,
  scatterTile,
} from "./boardScatters.ts";

describe.each(Object.entries(SCATTERS))("the scattered %s", (name, shapes) => {
  const tile = scatterTile(name as keyof typeof SCATTERS);
  const apart = (a: number, b: number) => {
    const d = Math.abs(a - b);
    return Math.min(d, tile - d);
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
    for (let x = 0; x < tile; x += 4) {
      for (let y = 0; y < tile; y += 4) {
        const nearest = Math.min(
          ...shapes.map((s) => Math.hypot(apart(x, s.x), apart(y, s.y)) - s.r),
        );
        widest = Math.max(widest, nearest);
      }
    }
    // The scatters leave 21px to 31px, more on the larger tile of the leaves
    // (its shapes are larger too). A bare seam, as a scatter kept inside its
    // tile left, would show here first.
    expect(widest).toBeLessThan((34 * tile) / SCATTER_TILE);
  });

  it("draws a shape that crosses an edge again on the far side", () => {
    const svg = svgOf(drawScatter(name as keyof typeof SCATTERS));
    const drawn = svg.match(/<(circle|path|rect|use) /g) ?? [];
    const crossing = shapes.filter(
      ({ x, y, r }) => x < r || x > tile - r || y < r || y > tile - r,
    );
    expect(crossing.length).toBeGreaterThan(0);
    expect(drawn.length).toBeGreaterThan(shapes.length);
  });
});
