import { describe, expect, it } from "vitest";
import {
  BLANK_PAPER,
  DRAWING_HEIGHT,
  DRAWING_WIDTH,
  drawingPoint,
  paperSizeFor,
  penScale,
  placeImages,
} from "./drawing.js";
import { MAX_IMAGE_EDGE } from "./shrinkImage.js";

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
  it("keeps the size of an image between the two edges", () => {
    expect(paperSizeFor({ width: 2000, height: 1500 })).toEqual({
      width: 2000,
      height: 1500,
    });
  });

  it("enlarges a small image to a new drawing's long edge, keeping its shape", () => {
    expect(paperSizeFor({ width: 300, height: 600 })).toEqual({
      width: 800,
      height: 1600,
    });
  });

  it("brings a large image down to the edge an attached one is kept at", () => {
    expect(paperSizeFor({ width: 5120, height: 2560 })).toEqual({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE / 2,
    });
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

describe("placeImages", () => {
  it("adds after the rest when nothing is replaced", () => {
    expect(placeImages(["a", "b"], ["c"])).toEqual(["a", "b", "c"]);
  });

  it("puts the new image where the one it replaces was", () => {
    expect(placeImages(["a", "b", "c"], ["b2"], "b")).toEqual(["a", "b2", "c"]);
  });

  it("keeps the new image when the one it replaces has gone", () => {
    expect(placeImages(["a", "c"], ["b2"], "b")).toEqual(["a", "c", "b2"]);
  });
});
