import { describe, expect, it } from "vitest";
import { closesPolygon, snapLine, snapSquare } from "./shapes.ts";

describe("shape tools", () => {
  it("keeps a held line at a step of 15 degrees, at its length", () => {
    const [x, y] = snapLine([0, 0], [100, 4]);
    expect(x).toBeCloseTo(Math.hypot(100, 4));
    expect(y).toBeCloseTo(0);
    const [dx, dy] = snapLine([0, 0], [50, 52]);
    expect(dx).toBeCloseTo(dy);
  });

  it("makes a held box square, in the direction of the drag", () => {
    expect(snapSquare([10, 10], [40, 20])).toEqual([40, 40]);
    expect(snapSquare([10, 10], [0, -30])).toEqual([-30, -30]);
  });

  it("closes a polygon of three corners or more near its first corner", () => {
    const corners: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    expect(closesPolygon(corners, [3, 4], 5)).toBe(true);
    expect(closesPolygon(corners, [30, 40], 5)).toBe(false);
    expect(closesPolygon(corners.slice(0, 2), [0, 0], 5)).toBe(false);
  });
});
