import {
  formatLocalISO,
  parseLocalISO,
  URGENT_REPEAT_MS,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { defined } from "#/test/defined.ts";
import {
  afterDone,
  afterFiring,
  CATCHUP_WINDOW_MS,
  DEDUPE_WINDOW_MS,
  isValidStoredReminder,
  type StoredReminder,
  stepFor,
} from "./swReminders.ts";

const DUE = "2026-10-03T09:00:00";
const dueMs = parseLocalISO(DUE).getTime();

function reminder(overrides: Partial<StoredReminder> = {}): StoredReminder {
  return {
    noteId: "n1",
    time: DUE,
    recurrence: "none",
    title: "Dentist",
    body: "Bring the x-rays",
    lastFiredAt: null,
    ...overrides,
  };
}

describe("isValidStoredReminder", () => {
  it("takes a reminder as the page sends it", () => {
    expect(isValidStoredReminder(reminder())).toBe(true);
    expect(
      isValidStoredReminder(reminder({ recurrence: "monthly", day: 31 })),
    ).toBe(true);
  });

  it.each([
    ["no note id", { noteId: "" }],
    ["a time that is not one", { time: "soon" }],
    ["a recurrence it does not know", { recurrence: "hourly" }],
    ["a day past the month's last", { day: 32 }],
    ["a day that is not whole", { day: 1.5 }],
    ["a title that is not text", { title: 3 }],
    ["a fired time that is not text", { lastFiredAt: 0 }],
  ])("refuses one with %s", (_what, overrides) => {
    expect(isValidStoredReminder({ ...reminder(), ...overrides })).toBe(false);
  });

  it("refuses what is not an object", () => {
    expect(isValidStoredReminder(null)).toBe(false);
    expect(isValidStoredReminder("n1")).toBe(false);
  });
});

describe("stepFor", () => {
  it("waits for a reminder that is not due yet", () => {
    expect(stepFor(reminder(), dueMs - 1)).toEqual({ kind: "wait" });
  });

  it("fires one that has come due", () => {
    expect(stepFor(reminder(), dueMs)).toEqual({ kind: "fire" });
    expect(stepFor(reminder(), dueMs + CATCHUP_WINDOW_MS)).toEqual({
      kind: "fire",
    });
  });

  it("fires a one-off reminder once, however many polls follow", () => {
    const fired = reminder({ lastFiredAt: new Date(dueMs).toISOString() });
    expect(stepFor(fired, dueMs + 5 * DEDUPE_WINDOW_MS)).toEqual({
      kind: "wait",
    });
  });

  it("does not fire the same occurrence twice within the dedupe window", () => {
    const daily = reminder({
      recurrence: "daily",
      lastFiredAt: new Date(dueMs).toISOString(),
    });
    expect(stepFor(daily, dueMs + DEDUPE_WINDOW_MS - 1)).toEqual({
      kind: "wait",
    });
  });

  it("drops a one-off reminder missed by more than the catch-up window", () => {
    expect(stepFor(reminder(), dueMs + CATCHUP_WINDOW_MS + 1)).toEqual({
      kind: "wait",
    });
  });

  it("moves a long-missed repeating reminder to its next occurrence without firing", () => {
    const now = dueMs + 3 * 24 * 60 * 60_000 + 60_000;
    const step = stepFor(reminder({ recurrence: "daily" }), now);
    expect(step.kind).toBe("skip");
    if (step.kind !== "skip") return;
    expect(parseLocalISO(step.next.time).getTime()).toBeGreaterThan(now);
    expect(step.next.time).toBe(
      formatLocalISO(new Date(dueMs + 4 * 24 * 60 * 60_000)),
    );
  });
});

describe("afterFiring", () => {
  const firedAt = "2026-10-03T07:00:00.000Z";

  it("marks a one-off reminder fired, and tells the pages it has no next", () => {
    expect(afterFiring(reminder(), firedAt)).toEqual({
      stored: reminder({ lastFiredAt: firedAt }),
      nextTime: null,
    });
  });

  it("moves a repeating one on, keeping the day it repeats on", () => {
    const monthly = reminder({
      recurrence: "monthly",
      time: "2026-02-28T09:00:00",
      day: 31,
    });
    const { stored, nextTime } = afterFiring(monthly, firedAt);
    expect(stored.time).toBe("2026-03-31T09:00:00");
    expect(stored.lastFiredAt).toBe(firedAt);
    expect(nextTime).toBe("2026-03-31T09:00:00");
  });
});

describe("urgent reminders", () => {
  const firedAt = new Date(dueMs).toISOString();

  it("stay at their time when they fire, and tell the pages no next", () => {
    const daily = reminder({ recurrence: "daily", urgent: true });
    expect(afterFiring(daily, firedAt)).toEqual({
      stored: { ...daily, lastFiredAt: firedAt },
      nextTime: null,
    });
  });

  it("fire again each URGENT_REPEAT_MS until done, also long after", () => {
    const fired = reminder({ urgent: true, lastFiredAt: firedAt });
    expect(stepFor(fired, dueMs + URGENT_REPEAT_MS - 1).kind).toBe("wait");
    expect(stepFor(fired, dueMs + URGENT_REPEAT_MS).kind).toBe("fire");
    expect(
      stepFor(reminder({ urgent: true }), dueMs + CATCHUP_WINDOW_MS * 5),
    ).toEqual({ kind: "fire" });
  });

  it("go to the next occurrence when done, or away when they do not repeat", () => {
    const now = dueMs + 3 * 24 * 60 * 60_000 + 1;
    const daily = reminder({
      recurrence: "daily",
      urgent: true,
      lastFiredAt: firedAt,
    });
    const next = defined(afterDone(daily, now) ?? undefined);
    expect(parseLocalISO(next.time).getTime()).toBeGreaterThan(now);
    expect(next.lastFiredAt).toBeNull();
    expect(next.urgent).toBe(true);
    expect(
      afterDone(reminder({ urgent: true, lastFiredAt: firedAt }), now),
    ).toBeNull();
  });

  it("refuse an urgent flag or a label that is not what a page sends", () => {
    expect(isValidStoredReminder(reminder({ urgent: true }))).toBe(true);
    expect(isValidStoredReminder({ ...reminder(), urgent: "yes" })).toBe(false);
    expect(
      isValidStoredReminder({ ...reminder(), doneLabel: "x".repeat(41) }),
    ).toBe(false);
  });
});
