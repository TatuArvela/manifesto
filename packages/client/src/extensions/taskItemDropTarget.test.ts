import { describe, expect, it } from "vitest";
import {
  type DropItem,
  dropLevel,
  INDENT_PX,
  listBoundaryAt,
  neighborIndex,
  slotAt,
  TOUCH_LIFT_PX,
  touchLift,
} from "./taskItemDropTarget.ts";

/** Items at these levels, all in one list. */
const list = (...levels: number[]): DropItem[] =>
  levels.map((level) => ({ level, outerListPos: 0 }));

describe("slotAt", () => {
  const middles = [10, 30, 50];

  it("is the slot before the first line whose middle is below the pointer", () => {
    expect(slotAt(3, (i) => middles[i] ?? 0, 5)).toBe(0);
    expect(slotAt(3, (i) => middles[i] ?? 0, 29)).toBe(1);
    expect(slotAt(3, (i) => middles[i] ?? 0, 30)).toBe(2);
    expect(slotAt(3, (i) => middles[i] ?? 0, 99)).toBe(3);
  });

  it("measures no line past the one it stops at", () => {
    const asked: number[] = [];
    slotAt(
      3,
      (i) => {
        asked.push(i);
        return middles[i] ?? 0;
      },
      15,
    );
    expect(asked).toEqual([0, 1]);
  });
});

describe("neighborIndex", () => {
  it("steps over the item being dragged", () => {
    // Dragging item 2 of 0..4, aimed between items 2 and 3.
    expect(neighborIndex(3, 2, "above")).toBe(1);
    expect(neighborIndex(3, 2, "below")).toBe(3);
    // Aimed between items 1 and 2.
    expect(neighborIndex(2, 2, "above")).toBe(1);
    expect(neighborIndex(2, 2, "below")).toBe(3);
  });
});

describe("listBoundaryAt", () => {
  const items: DropItem[] = [
    { level: 1, outerListPos: 0 },
    { level: 2, outerListPos: 0 },
    { level: 1, outerListPos: 40 },
    { level: 1, outerListPos: -1 },
  ];

  it("names the two items where one list ends and the next starts", () => {
    expect(listBoundaryAt(items, 2, 0)).toEqual({
      above: items[1],
      below: items[2],
    });
  });

  it("is null inside one list, at either end, and beside an item in no list", () => {
    expect(listBoundaryAt(items, 1, 3)).toBeNull();
    expect(listBoundaryAt(items, 0, 3)).toBeNull();
    expect(listBoundaryAt(items, 4, 0)).toBeNull();
    expect(listBoundaryAt(items, 3, 0)).toBeNull();
  });
});

describe("dropLevel", () => {
  it("indents one level for each step sideways", () => {
    const items = list(1, 1, 1);
    expect(dropLevel(items, 2, 2, 1, INDENT_PX, false)).toBe(2);
    expect(dropLevel(items, 2, 2, 1, INDENT_PX / 3, false)).toBe(1);
  });

  it("goes no deeper than one under the item above", () => {
    const items = list(1, 2, 1);
    expect(dropLevel(items, 2, 0, 1, INDENT_PX * 5, false)).toBe(3);
  });

  it("goes no shallower than the item below, which would become its child", () => {
    // Dropped between a level 2 and a level 3 item, pulled far left.
    const items = list(1, 2, 3, 1);
    expect(dropLevel(items, 2, 3, 3, -INDENT_PX * 5, false)).toBe(3);
  });

  it("ignores the item below at the end of a list", () => {
    const items = list(1, 2, 3, 1);
    expect(dropLevel(items, 2, 3, 3, -INDENT_PX * 5, true)).toBe(1);
  });

  it("puts the first item of the list at the top level", () => {
    expect(dropLevel(list(1, 1), 0, 1, 1, INDENT_PX * 3, false)).toBe(1);
  });
});

describe("touchLift", () => {
  it("grows at half the finger's travel, up to its most, and never shrinks", () => {
    expect(touchLift(0, 20)).toBe(10);
    expect(touchLift(0, -20)).toBe(10);
    expect(touchLift(0, 1000)).toBe(TOUCH_LIFT_PX);
    expect(touchLift(30, 10)).toBe(30);
  });
});
