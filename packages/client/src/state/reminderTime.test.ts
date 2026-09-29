import { describe, expect, it } from "vitest";
import {
  formatLocalISO,
  nextOccurrence,
  parseLocalISO,
  snapToFuture,
} from "./reminderTime.js";

/**
 * The recurrence maths on its own, in the Node project. The scheduler's
 * browser test covers each recurrence's single step; these follow a reminder
 * over many fires, which is what the scheduler does: each fire stores the next
 * occurrence as the reminder's new time and steps from that.
 */

/** The times a recurring reminder is set to over `count` fires. */
function fires(
  time: string,
  recurrence: "daily" | "weekly" | "monthly" | "yearly",
  count: number,
): string[] {
  const out = [time];
  let current = time;
  for (let i = 0; i < count; i++) {
    const next = nextOccurrence(current, recurrence);
    if (!next) break;
    out.push(next);
    current = next;
  }
  return out;
}

describe("parseLocalISO and formatLocalISO", () => {
  it("round-trip a local wall-clock time", () => {
    for (const iso of [
      "2026-01-01T00:00:00",
      "2026-03-29T02:30:00",
      "2026-12-31T23:59:59",
    ]) {
      const parsed = parseLocalISO(iso);
      // A time that does not exist on this clock (a spring-forward gap)
      // is moved by the platform; everything else comes back as written.
      if (parsed.getHours() === Number(iso.slice(11, 13))) {
        expect(formatLocalISO(parsed)).toBe(iso);
      }
    }
  });

  it("reads a date alone, and a time without seconds, as local", () => {
    expect(formatLocalISO(parseLocalISO("2026-05-01"))).toBe(
      "2026-05-01T00:00:00",
    );
    expect(formatLocalISO(parseLocalISO("2026-05-01T08:15"))).toBe(
      "2026-05-01T08:15:00",
    );
  });
});

describe("a recurring reminder over many fires", () => {
  it("keeps its time of day every day for a year", () => {
    const times = fires("2026-01-01T07:45:00", "daily", 365);
    expect(times.at(-1)).toBe("2027-01-01T07:45:00");
    for (const t of times) expect(t.slice(11)).toBe("07:45:00");
  });

  it("keeps its weekday every week", () => {
    const times = fires("2026-01-05T09:00:00", "weekly", 60);
    const day = parseLocalISO(times[0]).getDay();
    for (const t of times) expect(parseLocalISO(t).getDay()).toBe(day);
  });

  it("keeps a monthly day that every month has", () => {
    const times = fires("2026-01-15T09:00:00", "monthly", 24);
    for (const t of times) expect(t.slice(8, 10)).toBe("15");
    expect(times.at(-1)).toBe("2028-01-15T09:00:00");
  });

  it("crosses the year on a monthly reminder", () => {
    expect(nextOccurrence("2026-12-31T09:00:00", "monthly")).toBe(
      "2027-01-31T09:00:00",
    );
  });

  // Bug: the scheduler stores each next occurrence as the reminder's time
  // (reminderScheduler.ts `scheduleNext`), and `nextOccurrence` steps from
  // that clamped day, so a reminder on the 31st moves to the 28th in February
  // and stays there for good.
  it.fails("comes back to the 31st after a shorter month", () => {
    const times = fires("2026-01-31T09:00:00", "monthly", 3);
    expect(times).toEqual([
      "2026-01-31T09:00:00",
      "2026-02-28T09:00:00",
      "2026-03-31T09:00:00",
      "2026-04-30T09:00:00",
    ]);
  });

  // Bug: the same for a yearly reminder on 29 February, which falls back to
  // the 28th in 2025 and never returns to the 29th in a leap year.
  it.fails("comes back to 29 February in the next leap year", () => {
    const times = fires("2024-02-29T09:00:00", "yearly", 4);
    expect(times.at(-1)).toBe("2028-02-29T09:00:00");
  });
});

describe("snapToFuture", () => {
  const now = parseLocalISO("2026-06-15T12:00:00");

  it("moves a missed recurring reminder to its first occurrence after now", () => {
    expect(snapToFuture("2026-06-01T09:00:00", "daily", now)).toBe(
      "2026-06-16T09:00:00",
    );
    expect(snapToFuture("2026-06-15T11:59:59", "daily", now)).toBe(
      "2026-06-16T11:59:59",
    );
    expect(snapToFuture("2026-05-01T09:00:00", "weekly", now)).toBe(
      "2026-06-19T09:00:00",
    );
    expect(snapToFuture("2025-07-20T09:00:00", "monthly", now)).toBe(
      "2026-06-20T09:00:00",
    );
    expect(snapToFuture("2020-01-01T09:00:00", "yearly", now)).toBe(
      "2027-01-01T09:00:00",
    );
  });

  it("leaves a reminder that is still ahead, or does not recur, alone", () => {
    expect(snapToFuture("2026-06-15T12:00:01", "daily", now)).toBe(
      "2026-06-15T12:00:01",
    );
    expect(snapToFuture("2020-01-01T09:00:00", "none", now)).toBe(
      "2020-01-01T09:00:00",
    );
  });

  it("treats a time exactly now as missed", () => {
    expect(snapToFuture("2026-06-15T12:00:00", "daily", now)).toBe(
      "2026-06-16T12:00:00",
    );
  });

  // Bug: the loop gives up after 1000 steps, so a daily reminder last set
  // more than about three years ago is still in the past after the snap the
  // scheduler makes, and reaches today only over several snaps and writes.
  it.fails("reaches the future from a daily reminder years behind", () => {
    const snapped = snapToFuture("2020-01-01T09:00:00", "daily", now);
    expect(parseLocalISO(snapped).getTime()).toBeGreaterThan(now.getTime());
  });
});
