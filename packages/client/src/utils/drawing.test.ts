import { describe, expect, it } from "vitest";
import {
  BLANK_PAPER,
  DRAWING_HEIGHT,
  DRAWING_WIDTH,
  drawingPoint,
  inkArea,
  intersect,
  markBounds,
  paperSizeFor,
  penScale,
  resizeAround,
  stampCenters,
  transformMark,
  transformStroke,
} from "./drawing.ts";

describe("drawingPoint", () => {
  // The paper shown at a quarter of its size, away from the corner.
  const shown = { left: 100, top: 50, width: 400, height: 300 };

  it("scales a place on the screen to the same place on the paper", () => {
    expect(drawingPoint({ clientX: 100, clientY: 50 }, shown)).toEqual([0, 0]);
    expect(drawingPoint({ clientX: 300, clientY: 200 }, shown)).toEqual([
      DRAWING_WIDTH / 2,
      DRAWING_HEIGHT / 2,
    ]);
  });

  it("holds a pointer that left the paper at the paper's edge", () => {
    expect(drawingPoint({ clientX: 0, clientY: 9999 }, shown)).toEqual([
      0,
      DRAWING_HEIGHT,
    ]);
    expect(drawingPoint({ clientX: 9999, clientY: 0 }, shown)).toEqual([
      DRAWING_WIDTH,
      0,
    ]);
  });

  it("scales to the paper it is given, each axis by its own", () => {
    const paper = { width: 800, height: 1600 };
    expect(
      drawingPoint(
        { clientX: 150, clientY: 250 },
        { left: 50, top: 50, width: 200, height: 400 },
        paper,
      ),
    ).toEqual([400, 800]);
  });
});

describe("paperSizeFor", () => {
  it("keeps the own size of an image", () => {
    for (const size of [
      { width: 2000, height: 1500 },
      { width: 300, height: 600 },
      { width: 5120, height: 2560 },
    ]) {
      expect(paperSizeFor(size)).toEqual(size);
    }
  });

  it("has no paper for an image without a size", () => {
    expect(paperSizeFor({ width: 0, height: 0 })).toBeNull();
    expect(paperSizeFor({ width: 100, height: 0 })).toBeNull();
  });
});

describe("penScale", () => {
  it("widens the pen with the paper, so it looks the same on screen", () => {
    expect(penScale(BLANK_PAPER)).toBe(1);
    expect(penScale({ width: 1200, height: 2400 })).toBe(1.5);
  });
});

describe("stampCenters", () => {
  it("presses the tip at steps short enough to join into a line", () => {
    const centers = stampCenters(
      [
        [0, 0],
        [60, 0],
      ],
      12,
    );
    expect(centers.at(0)).toEqual([0, 0]);
    expect(centers.at(-1)).toEqual([60, 0]);
    // A sixth of the width at most between two shapes.
    for (const [i, center] of centers.slice(1).entries()) {
      const before = centers[i] ?? center;
      expect(center[0] - before[0]).toBeLessThanOrEqual(2);
    }
  });

  it("presses one shape for a tap, and none for no points", () => {
    expect(stampCenters([[5, 5]], 10)).toEqual([[5, 5]]);
    expect(stampCenters([], 10)).toEqual([]);
  });
});

describe("moving and resizing strokes", () => {
  const stroke = {
    color: "#000",
    width: 10,
    points: [
      [10, 20],
      [30, 40],
    ] as [number, number][],
  };

  it("finds the box of the ink, the width of the tip included", () => {
    expect(markBounds([stroke])).toEqual({
      x: 5,
      y: 15,
      width: 30,
      height: 30,
    });
    expect(markBounds([])).toBeNull();
  });

  it("finds no ink in an eraser", () => {
    expect(markBounds([{ ...stroke, erase: true }])).toBeNull();
    expect(markBounds([stroke, { ...stroke, erase: true }])).toEqual(
      markBounds([stroke]),
    );
  });

  it("moves the points, and scales the width with them", () => {
    const moved = transformStroke(stroke, { scale: 2, dx: 1, dy: -1 });
    expect(moved.points).toEqual([
      [21, 39],
      [61, 79],
    ]);
    expect(moved.width).toBe(20);
  });

  it("resizes from the opposite corner, the same on both axes", () => {
    const box = { x: 10, y: 10, width: 100, height: 50 };
    const by = resizeAround(box, "se", [210, 20]);
    expect(by.scale).toBe(2);
    // The top left corner stays.
    expect(10 * by.scale + by.dx).toBe(10);
    expect(10 * by.scale + by.dy).toBe(10);
    // Never to nothing, and never past its limit.
    expect(resizeAround(box, "se", [0, 0]).scale).toBe(0.05);
    expect(resizeAround(box, "se", [99999, 0]).scale).toBe(20);
    // From the top left handle, the bottom right corner stays.
    const up = resizeAround(box, "nw", [-90, 10]);
    expect(up.scale).toBe(2);
    expect(110 * up.scale + up.dx).toBe(110);
    expect(60 * up.scale + up.dy).toBe(60);
  });
});

describe("crops", () => {
  const stroke = {
    color: "#000",
    width: 10,
    points: [
      [10, 20],
      [30, 40],
    ] as [number, number][],
  };

  it("finds the area two boxes share", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(intersect(a, { x: 5, y: 5, width: 10, height: 10 })).toEqual({
      x: 5,
      y: 5,
      width: 5,
      height: 5,
    });
    expect(intersect(a, { x: 20, y: 0, width: 5, height: 5 })).toBeNull();
  });

  it("gives a cut group only the box that still shows", () => {
    const clip = { x: 0, y: 0, width: 20, height: 100 };
    expect(markBounds([{ clip, marks: [stroke] }])).toEqual({
      x: 5,
      y: 15,
      width: 15,
      height: 30,
    });
    // Cut to an area with none of its ink: nothing shows.
    const away = { x: 500, y: 500, width: 10, height: 10 };
    expect(markBounds([{ clip: away, marks: [stroke] }])).toBeNull();
  });
});

describe("shapes and fills", () => {
  it("moves a shape's corners and widens its outline", () => {
    const shape = {
      shape: "rect" as const,
      points: [
        [0, 0],
        [10, 20],
      ] as [number, number][],
      width: 4,
      color: "#000",
    };
    const moved = transformMark(shape, { scale: 2, dx: 5, dy: 0 });
    expect(moved).toEqual({
      ...shape,
      width: 8,
      points: [
        [5, 0],
        [25, 40],
      ],
    });
    expect(markBounds([shape])).toEqual({
      x: -2,
      y: -2,
      width: 14,
      height: 24,
    });
  });

  it("gives a fill its own box, and moves it with the layer", () => {
    const fill = {
      image: {} as CanvasImageSource,
      at: { x: 1, y: 2, width: 3, height: 4 },
    };
    expect(markBounds([fill])).toEqual(fill.at);
    expect(transformMark(fill, { scale: 2, dx: 0, dy: 1 })).toEqual({
      ...fill,
      at: { x: 2, y: 5, width: 6, height: 8 },
    });
  });
});

describe("inkArea", () => {
  it("keeps a margin of half the paper on each side", () => {
    expect(inkArea(BLANK_PAPER)).toEqual({
      x: -DRAWING_WIDTH / 2,
      y: -DRAWING_HEIGHT / 2,
      width: DRAWING_WIDTH * 2,
      height: DRAWING_HEIGHT * 2,
    });
  });

  it("keeps a smaller margin on a large image, inside the limit of a canvas", () => {
    const area = inkArea({ width: 2560, height: 2560 });
    expect(area.width * area.height).toBeLessThanOrEqual(16_000_000);
    expect(area.x).toBeLessThan(0);
    expect(area.x + area.width).toBeGreaterThan(2560);
  });
});
