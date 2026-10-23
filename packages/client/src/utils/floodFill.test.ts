import { describe, expect, it } from "vitest";
import { floodFill, growArea } from "./floodFill.ts";

/** A picture of `rows`: "#" is black, "." white. */
function picture(rows: string[]) {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [y, row] of rows.entries()) {
    for (const [x, cell] of [...row].entries()) {
      const p = (y * width + x) * 4;
      const v = cell === "#" ? 0 : 255;
      data.set([v, v, v, 255], p);
    }
  }
  return { data, width, height };
}

const shown = (mask: Uint8Array, width: number) =>
  [...mask].reduce<string[]>((rows, v, i) => {
    const y = Math.floor(i / width);
    rows[y] = (rows[y] ?? "") + (v ? "o" : ".");
    return rows;
  }, []);

describe("floodFill", () => {
  const ring = picture([
    ".......",
    ".#####.",
    ".#...#.",
    ".#...#.",
    ".#####.",
    ".......",
  ]);

  it("fills the inside of a closed line, and stops at the line", () => {
    const area = floodFill(ring.data, ring.width, ring.height, 3, 2);
    expect(area?.bounds).toEqual({ x: 2, y: 2, width: 3, height: 2 });
    expect(shown(area?.mask ?? new Uint8Array(), ring.width)).toEqual([
      ".......",
      ".......",
      "..ooo..",
      "..ooo..",
      ".......",
      ".......",
    ]);
  });

  it("goes around the outside, and not through the line", () => {
    const area = floodFill(ring.data, ring.width, ring.height, 0, 0);
    const mask = area?.mask ?? new Uint8Array();
    expect(mask[2 * ring.width + 3]).toBe(0);
    expect(mask[5 * ring.width + 6]).toBe(1);
  });

  it("takes nearly the same color with it, and not a different one", () => {
    const { data, width, height } = picture(["..", ".."]);
    data.set([240, 240, 240, 255], 4);
    data.set([100, 100, 100, 255], 8);
    const area = floodFill(data, width, height, 0, 0);
    expect([...(area?.mask ?? [])]).toEqual([1, 1, 0, 1]);
  });

  it("fills runs that join below a gap, and each pixel one time", () => {
    const comb = picture([".......", "#.#.#.#", "#.#.#.#", "......."]);
    const area = floodFill(comb.data, comb.width, comb.height, 1, 1);
    expect(shown(area?.mask ?? new Uint8Array(), comb.width)).toEqual([
      "ooooooo",
      ".o.o.o.",
      ".o.o.o.",
      "ooooooo",
    ]);
  });

  it("finds nothing outside the picture", () => {
    expect(floodFill(ring.data, ring.width, ring.height, -1, 0)).toBeNull();
    expect(floodFill(ring.data, ring.width, ring.height, 7, 0)).toBeNull();
  });

  it("grows the area by a pixel, over the soft edge of a line", () => {
    const area = floodFill(ring.data, ring.width, ring.height, 3, 2);
    if (!area) throw new Error("no area");
    const grown = growArea(area);
    expect(grown.bounds).toEqual({ x: 1, y: 1, width: 5, height: 4 });
    expect(shown(grown.mask, ring.width)[1]).toBe("..ooo..");
  });
});
