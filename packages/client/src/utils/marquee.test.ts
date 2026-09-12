import { describe, expect, it } from "vitest";
import {
  boxesIntersect,
  boxFromPoints,
  edgeScrollStep,
  marqueeSelection,
} from "./marquee.js";

describe("boxFromPoints", () => {
  it("normalises a drag up and to the left", () => {
    expect(boxFromPoints({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({
      left: 10,
      top: 20,
      right: 50,
      bottom: 80,
    });
  });
});

describe("boxesIntersect", () => {
  const card = { left: 100, top: 100, right: 200, bottom: 200 };

  it("counts a box that clips a corner of the card", () => {
    expect(
      boxesIntersect({ left: 0, top: 0, right: 101, bottom: 101 }, card),
    ).toBe(true);
  });

  it("does not count a box that only touches an edge", () => {
    expect(
      boxesIntersect({ left: 0, top: 0, right: 100, bottom: 300 }, card),
    ).toBe(false);
  });

  it("counts a box lying wholly inside the card", () => {
    expect(
      boxesIntersect({ left: 120, top: 120, right: 130, bottom: 130 }, card),
    ).toBe(true);
  });
});

describe("marqueeSelection", () => {
  it("replaces the selection by default", () => {
    expect([...marqueeSelection(new Set(["a"]), ["b"], false)]).toEqual(["b"]);
  });

  it("adds to the selection when the drag is additive", () => {
    expect([...marqueeSelection(new Set(["a"]), ["b"], true)]).toEqual([
      "a",
      "b",
    ]);
  });

  it("gives back what was selected when the box has shrunk off every note", () => {
    expect([...marqueeSelection(new Set(["a"]), [], true)]).toEqual(["a"]);
  });
});

describe("edgeScrollStep", () => {
  it("does not scroll away from the edges", () => {
    expect(edgeScrollStep(300, 0, 600)).toBe(0);
  });

  it("scrolls up near the top and down near the bottom", () => {
    expect(edgeScrollStep(10, 0, 600)).toBeLessThan(0);
    expect(edgeScrollStep(590, 0, 600)).toBeGreaterThan(0);
  });

  it("speeds up towards the edge and past it, up to a limit", () => {
    expect(Math.abs(edgeScrollStep(40, 0, 600))).toBeLessThan(
      Math.abs(edgeScrollStep(5, 0, 600)),
    );
    expect(edgeScrollStep(-200, 0, 600)).toBe(-18);
  });
});
