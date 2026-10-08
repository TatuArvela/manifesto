import type { ReminderPush } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { afterPush, readReminderPush } from "./swPush.js";

const push: ReminderPush = {
  type: "reminder",
  noteId: "01J",
  title: "Dentist",
  body: "Bring the x-rays",
  next: null,
  firedAt: "2026-10-03T12:00:00.000Z",
};

describe("readReminderPush", () => {
  it("takes a reminder as the server sends it", () => {
    expect(readReminderPush(push)).toEqual(push);
    const repeating = {
      ...push,
      next: { time: "2026-10-04T11:58:00", day: 31 },
    };
    expect(readReminderPush(repeating)).toEqual(repeating);
  });

  it("keeps only the fields it knows", () => {
    expect(readReminderPush({ ...push, extra: "x" })).toEqual(push);
  });

  it.each([
    ["nothing", null],
    ["text", "reminder"],
    ["another kind of message", { ...push, type: "note" }],
    ["no note", { ...push, noteId: "" }],
    ["a title that is not text", { ...push, title: 7 }],
    ["no time of firing", { ...push, firedAt: undefined }],
    ["a next that is not a reminder", { ...push, next: "tomorrow" }],
    ["a next with no time", { ...push, next: {} }],
    ["a next whose time is not one", { ...push, next: { time: "soon" } }],
    ["a day no month has", { ...push, next: { time: "2026-10-04", day: 32 } }],
  ])("refuses %s", (_name, payload) => {
    expect(readReminderPush(payload)).toBeNull();
  });
});

describe("afterPush", () => {
  const held = {
    noteId: "01J",
    time: "2026-10-03T11:58:00",
    recurrence: "monthly" as const,
    day: 31,
    title: "Dentist",
    body: "",
    lastFiredAt: null,
  };

  it("marks a reminder that does not repeat as fired, where it stands", () => {
    expect(afterPush(held, push)).toEqual({
      ...held,
      lastFiredAt: push.firedAt,
    });
  });

  it("moves a repeating one to where the server moved it", () => {
    expect(
      afterPush(held, {
        ...push,
        next: { time: "2026-11-30T11:58:00", day: 31 },
      }),
    ).toEqual({
      ...held,
      time: "2026-11-30T11:58:00",
      day: 31,
      lastFiredAt: push.firedAt,
    });
  });

  it("drops the repeat day once the new time shows it", () => {
    const moved = afterPush(held, {
      ...push,
      next: { time: "2026-12-31T11:58:00" },
    });
    expect(moved.time).toBe("2026-12-31T11:58:00");
    expect("day" in moved).toBe(false);
  });
});
