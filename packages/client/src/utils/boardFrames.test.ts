import { describe, expect, it } from "vitest";
import { svgOf } from "#/test/svgOf.ts";
import {
  drawFrames,
  FRAME_THINNEST,
  FRAMES,
  FRAMES_TILE,
} from "./boardFrames.ts";

describe("the frames", () => {
  it("puts each centre on the tile, largest first", () => {
    expect(FRAMES.length).toBeGreaterThan(20);
    for (const [i, frame] of FRAMES.entries()) {
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.x).toBeLessThan(FRAMES_TILE);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeLessThan(FRAMES_TILE);
      // The inner outline of the ring has room for itself.
      expect(frame.width).toBeGreaterThan(2 * frame.line);
      expect(frame.height).toBeGreaterThan(2 * frame.line);
      const before = FRAMES[i - 1];
      if (before) {
        expect(before.width * before.height).toBeGreaterThanOrEqual(
          frame.width * frame.height,
        );
      }
    }
  });

  // A side thinner than that flickers as it moves on a scaled screen.
  it("moves each hole off the centre, and keeps each side wide enough", () => {
    for (const { line, hole } of FRAMES) {
      expect(Math.abs(hole.x)).toBeLessThanOrEqual(line - FRAME_THINNEST);
      expect(Math.abs(hole.y)).toBeLessThanOrEqual(line - FRAME_THINNEST);
    }
    const moved = FRAMES.filter(({ hole }) => Math.hypot(hole.x, hole.y) > 0.5);
    expect(moved.length).toBeGreaterThan(FRAMES.length / 2);
  });

  // A frame that crosses an edge and is drawn on one side only shows the seam
  // of the tile as a frame that is cut.
  it("draws a frame that crosses an edge again on the far side", () => {
    const svg = svgOf(drawFrames());
    const drawn = svg.match(/<path /g) ?? [];
    expect(drawn.length).toBeGreaterThan(FRAMES.length);
  });
});
