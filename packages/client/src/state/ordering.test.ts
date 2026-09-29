import type { Note } from "@manifesto/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  byPosition,
  headPosition,
  headPositions,
  POSITION_STEP,
  positionBetween,
} from "./ordering.js";

function at(id: string, position: number): Note {
  return { id, position } as Note;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("byPosition", () => {
  it("orders by position, and by id where two notes share one", () => {
    const notes = [at("c", 2), at("b", 1), at("a", 1), at("d", -5)];
    expect(notes.sort(byPosition).map((n) => n.id)).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
  });

  it("gives two devices holding the same notes in another order the same result", () => {
    const one = [at("01B", 7), at("01A", 7), at("01C", 3)];
    const two = [...one].reverse();
    expect(one.sort(byPosition)).toEqual(two.sort(byPosition));
  });
});

describe("positionBetween", () => {
  it("halves the gap between two neighbours", () => {
    expect(positionBetween(1000, 2000)).toBe(1500);
    expect(positionBetween(-3000, -1000)).toBe(-2000);
  });

  it("goes a step past the end it has no neighbour on", () => {
    expect(positionBetween(undefined, 1000)).toBe(1000 - POSITION_STEP);
    expect(positionBetween(1000, undefined)).toBe(1000 + POSITION_STEP);
    expect(positionBetween(undefined, undefined)).toBeNull();
  });

  it("asks for a renumbering when neighbours are tied or out of order", () => {
    expect(positionBetween(5, 5)).toBeNull();
    expect(positionBetween(6, 5)).toBeNull();
  });

  it("lasts about fifty halvings of a step, then asks for a renumbering", () => {
    let before = 0;
    const after = POSITION_STEP;
    let halvings = 0;
    for (;;) {
      const next = positionBetween(before, after);
      if (next === null) break;
      expect(next).toBeGreaterThan(before);
      expect(next).toBeLessThan(after);
      before = next;
      halvings++;
    }
    expect(halvings).toBeGreaterThan(40);
    expect(halvings).toBeLessThan(60);
  });

  it("never lands on a neighbour, even far from zero", () => {
    const big = 2 ** 52;
    expect(positionBetween(big, big + 1)).toBeNull();
    const between = positionBetween(-(10 ** 15), -(10 ** 15) + 2);
    expect(between).toBe(-(10 ** 15) + 1);
  });
});

describe("headPositions", () => {
  it("puts new notes ahead of every note, the first given the topmost slot", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const held = [at("a", -1_000_000), at("b", 5)];
    const slots = headPositions(held, 3);
    expect(slots).toEqual([
      -1_000_000 - 3 * POSITION_STEP,
      -1_000_000 - 2 * POSITION_STEP,
      -1_000_000 - POSITION_STEP,
    ]);
    for (const slot of slots) expect(slot).toBeLessThan(-1_000_000);
  });

  it("counts down from minus the clock, so a later note on another device goes first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const early = headPosition([]);
    vi.setSystemTime(2_000_000);
    const late = headPosition([]);
    expect(early).toBe(-1_000_000);
    expect(late).toBeLessThan(early);
  });

  it("gives nothing for no notes", () => {
    expect(headPositions([at("a", 0)], 0)).toEqual([]);
  });
});
