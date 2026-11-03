import { describe, expect, it } from "vitest";
import {
  drawLeaf,
  LEAF_DEFS,
  LEAF_NARROWEST,
  leafLooks,
} from "./boardLeaves.ts";
import { seeded } from "./boardSvg.ts";

describe("the maple leaves", () => {
  const looks = leafLooks(400, seeded(1));

  it("uses each shape, the broad leaf most", () => {
    const counts = [0, 0, 0, 0];
    for (const { shape } of looks) counts[shape] = (counts[shape] ?? 0) + 1;
    expect(counts.every((n) => n > 0)).toBe(true);
    expect(Math.max(...counts)).toBe(counts[0]);
  });

  it("tilts some leaves, never past the narrowest, and never a tumbling one", () => {
    const tilted = looks.filter(({ across, along }) => across < 1 || along < 1);
    expect(tilted.length).toBeGreaterThan(looks.length / 4);
    expect(tilted.length).toBeLessThan(looks.length);
    for (const { shape, across, along } of looks) {
      expect(Math.min(across, along)).toBeGreaterThanOrEqual(LEAF_NARROWEST);
      // A leaf is squashed along one axis only.
      expect(across === 1 || along === 1).toBe(true);
      if (shape === 3) expect([across, along]).toEqual([1, 1]);
    }
  });

  it("draws each shape one time in the defs, opaque", () => {
    expect(LEAF_DEFS.match(/<path id='m\d'/g)).toHaveLength(4);
    expect(LEAF_DEFS).not.toMatch(/fill|opacity/);
  });

  // A leaf drawn past its reach is cut where it crosses an edge of the tile,
  // because the scatter draws it again past an edge only within its reach.
  it("draws each shape no farther than its reach", () => {
    const paths = [...LEAF_DEFS.matchAll(/ d='([^']*)'/g)].map(
      ([, d = ""]) => d,
    );
    for (const [shape, d] of paths.entries()) {
      const farthest = Math.max(
        ...[...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(
          ([, x = "0", y = "0"]) => Math.hypot(Number(x), Number(y)),
        ),
      );
      const look = { shape: shape as 0 | 1 | 2 | 3, across: 1, along: 1 };
      const scale = Number(
        /scale\(([\d.]+) /.exec(drawLeaf(look, 20, 0, 0, 0))?.[1],
      );
      expect(farthest * scale, `shape ${shape}`).toBeLessThanOrEqual(20.01);
      expect(farthest * scale, `shape ${shape}`).toBeGreaterThan(19.9);
    }
  });
});
