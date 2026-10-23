import { describe, expect, it } from "vitest";
import { type CardAction, overflowingActions } from "./cardActionsFit.ts";

const ALL: CardAction[] = [
  "color",
  "font",
  "reminder",
  "image",
  "draw",
  "tags",
];

describe("overflowingActions", () => {
  it("keeps every button on a big card", () => {
    expect(
      overflowingActions({
        room: { width: 250, phone: false },
        actions: ALL,
        leading: 0,
        overlay: false,
      }),
    ).toEqual([]);
  });

  it("moves the last buttons into the menu on a small card on a phone", () => {
    // 170px less 28px of inset is 142px: three 36px buttons, the menu and two.
    expect(
      overflowingActions({
        room: { width: 170, phone: true },
        actions: ALL,
        leading: 0,
        overlay: false,
      }),
    ).toEqual(["reminder", "image", "draw", "tags"]);
  });

  it("counts the buttons of an auto-note before them", () => {
    expect(
      overflowingActions({
        room: { width: 180, phone: false },
        actions: ["color", "reminder", "tags"],
        leading: 2,
        overlay: false,
      }),
    ).toEqual(["reminder", "tags"]);
  });

  it("uses the smaller inset of the row over an image", () => {
    const room = { width: 244, phone: false };
    expect(
      overflowingActions({ room, actions: ALL, leading: 0, overlay: false }),
    ).toEqual(["tags"]);
    expect(
      overflowingActions({ room, actions: ALL, leading: 0, overlay: true }),
    ).toEqual([]);
  });

  it("moves all of them when only the menu fits", () => {
    expect(
      overflowingActions({
        room: { width: 40, phone: true },
        actions: ALL,
        leading: 0,
        overlay: false,
      }),
    ).toEqual(ALL);
  });
});
