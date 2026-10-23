import type { NoteReminder } from "@manifesto/shared";
import {
  advanceReminder,
  afterFire,
  awaitsDone,
  formatLocalISO,
  instantOf,
  nextFireAt,
  nextOccurrence,
  parseLocalISO,
  pickedReminder,
  reminderAt,
  reminderDone,
  snapReminderToFuture,
  snapToFuture,
  URGENT_REPEAT_MS,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { defined } from "#/test/defined.ts";

/**
 * Only the recurrence arithmetic, in the Node project. The browser test of the
 * scheduler covers the single step of each recurrence. These tests follow a
 * reminder over many fires, as the scheduler does. Each fire stores the
 * advanced reminder (its next time, and the day on which it repeats when a
 * short month hides it), and steps from that.
 */

/** The times to which a recurring reminder is set over `count` fires. */
function fires(
  time: string,
  recurrence: "daily" | "weekly" | "monthly" | "yearly",
  count: number,
): string[] {
  const out = [time];
  let current: Pick<NoteReminder, "time" | "recurrence" | "day"> = {
    time,
    recurrence,
  };
  for (let i = 0; i < count; i++) {
    const next = advanceReminder(current);
    if (!next) break;
    out.push(next.time);
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
      // The platform moves a time that does not exist on this clock (a
      // spring-forward gap). All other times come back as written.
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
    const day = parseLocalISO(defined(times[0])).getDay();
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

  it("comes back to the 31st after a shorter month", () => {
    const times = fires("2026-01-31T09:00:00", "monthly", 3);
    expect(times).toEqual([
      "2026-01-31T09:00:00",
      "2026-02-28T09:00:00",
      "2026-03-31T09:00:00",
      "2026-04-30T09:00:00",
    ]);
  });

  it("comes back to 29 February in the next leap year", () => {
    expect(fires("2024-02-29T09:00:00", "yearly", 4)).toEqual([
      "2024-02-29T09:00:00",
      "2025-02-28T09:00:00",
      "2026-02-28T09:00:00",
      "2027-02-28T09:00:00",
      "2028-02-29T09:00:00",
    ]);
  });

  // 02:30 does not exist on 8 March 2026 in New York, and 03:30 does not exist
  // on 29 March 2026 in Helsinki. When read back through a Date, the hour came
  // out one hour late, and each later occurrence kept it.
  it("keeps its hour through a daylight saving gap, in any zone", () => {
    expect(fires("2026-03-07T02:30:00", "daily", 2)).toEqual([
      "2026-03-07T02:30:00",
      "2026-03-08T02:30:00",
      "2026-03-09T02:30:00",
    ]);
    expect(fires("2026-03-22T03:30:00", "weekly", 2)).toEqual([
      "2026-03-22T03:30:00",
      "2026-03-29T03:30:00",
      "2026-04-05T03:30:00",
    ]);
  });

  it("keeps the 30th through February and a leap year", () => {
    expect(fires("2028-01-30T09:00:00", "monthly", 3)).toEqual([
      "2028-01-30T09:00:00",
      "2028-02-29T09:00:00",
      "2028-03-30T09:00:00",
      "2028-04-30T09:00:00",
    ]);
  });
});

describe("the day a reminder repeats on", () => {
  it("is stored only while a short month hides it", () => {
    const feb = advanceReminder({
      time: "2026-01-31T09:00:00",
      recurrence: "monthly",
    });
    expect(feb).toEqual({
      time: "2026-02-28T09:00:00",
      recurrence: "monthly",
      day: 31,
    });
    expect(feb && advanceReminder(feb)).toEqual({
      time: "2026-03-31T09:00:00",
      recurrence: "monthly",
    });
  });

  it("is never stored for a reminder no month clamps", () => {
    for (const recurrence of [
      "daily",
      "weekly",
      "monthly",
      "yearly",
    ] as const) {
      const next = advanceReminder({ time: "2026-01-15T09:00:00", recurrence });
      expect(next, recurrence).not.toHaveProperty("day");
    }
  });

  it("follows a reminder moved to a time, and leaves one that does not repeat by date", () => {
    const clamped = {
      time: "2026-02-28T09:00:00",
      recurrence: "monthly",
      day: 31,
    } as const;
    expect(reminderAt(clamped, "2026-04-30T10:00:00")).toEqual({
      time: "2026-04-30T10:00:00",
      recurrence: "monthly",
      day: 31,
    });
    expect(
      reminderAt({ ...clamped, recurrence: "weekly" }, "2026-03-07T09:00:00"),
    ).toEqual({ time: "2026-03-07T09:00:00", recurrence: "weekly" });
  });

  it("survives a snap past missed occurrences", () => {
    const snapped = snapReminderToFuture(
      { time: "2026-01-31T09:00:00", recurrence: "monthly" },
      parseLocalISO("2026-03-01T00:00:00"),
    );
    expect(snapped).toEqual({
      time: "2026-03-31T09:00:00",
      recurrence: "monthly",
    });
    const intoApril = snapReminderToFuture(
      { time: "2026-01-31T09:00:00", recurrence: "monthly" },
      parseLocalISO("2026-04-01T00:00:00"),
    );
    expect(intoApril).toEqual({
      time: "2026-04-30T09:00:00",
      recurrence: "monthly",
      day: 31,
    });
  });

  it("moves a daily or weekly reminder days behind to its next occurrence", () => {
    // The repeat day stayed the day for which the reminder was set, and a step
    // from it went back to the day after. The snap went into the past, and
    // stayed there.
    const now = parseLocalISO("2026-10-06T09:01:00");
    expect(
      snapReminderToFuture(
        { time: "2026-10-03T09:00:00", recurrence: "daily" },
        now,
      ),
    ).toEqual({ time: "2026-10-07T09:00:00", recurrence: "daily" });
    expect(
      snapReminderToFuture(
        { time: "2026-09-01T09:00:00", recurrence: "weekly" },
        now,
      ),
    ).toEqual({ time: "2026-10-13T09:00:00", recurrence: "weekly" });
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

  it("reaches the first occurrence after now from a reminder years behind", () => {
    // When it moved one step at a time, the loop stopped after 1000 days.
    expect(snapToFuture("2020-01-01T09:00:00", "daily", now)).toBe(
      "2026-06-16T09:00:00",
    );
    expect(snapToFuture("2020-01-01T13:00:00", "daily", now)).toBe(
      "2026-06-15T13:00:00",
    );
    // 2020-01-06 was a Monday, and so is 2026-06-15. Noon is past.
    expect(snapToFuture("2020-01-06T09:00:00", "weekly", now)).toBe(
      "2026-06-22T09:00:00",
    );
    expect(snapToFuture("2020-01-06T13:00:00", "weekly", now)).toBe(
      "2026-06-15T13:00:00",
    );
  });

  it("gives the same answer as stepping, across daylight saving changes", () => {
    const stepped = (time: string, recurrence: "daily" | "weekly") => {
      let current = time;
      while (parseLocalISO(current).getTime() <= now.getTime()) {
        current = nextOccurrence(current, recurrence) ?? current;
      }
      return current;
    };
    for (const time of [
      "2025-10-20T02:30:00",
      "2026-03-01T23:59:59",
      "2026-06-14T12:00:00",
      "2026-06-08T12:00:01",
    ]) {
      for (const recurrence of ["daily", "weekly"] as const) {
        expect(
          snapToFuture(time, recurrence, now),
          `${time} ${recurrence}`,
        ).toBe(stepped(time, recurrence));
      }
    }
  });
});

describe("pickedReminder", () => {
  const now = parseLocalISO("2026-02-10T12:00:00");
  const clamped = {
    time: "2026-02-28T09:00:00",
    recurrence: "monthly",
    day: 31,
  } as const;

  it("keeps a clamped reminder's day when only its hour changes", () => {
    expect(
      pickedReminder(clamped, "2026-02-28T18:30:00", "monthly", now),
    ).toEqual({ time: "2026-02-28T18:30:00", recurrence: "monthly", day: 31 });
  });

  it("starts from the date picked when the date or the recurrence changes", () => {
    expect(
      pickedReminder(clamped, "2026-02-27T09:00:00", "monthly", now),
    ).toEqual({ time: "2026-02-27T09:00:00", recurrence: "monthly" });
    expect(
      pickedReminder(clamped, "2026-02-28T09:00:00", "weekly", now),
    ).toEqual({ time: "2026-02-28T09:00:00", recurrence: "weekly" });
  });

  it("moves a recurring time already past to its next occurrence, keeping its day", () => {
    expect(pickedReminder(null, "2026-01-31T09:00:00", "monthly", now)).toEqual(
      { time: "2026-02-28T09:00:00", recurrence: "monthly", day: 31 },
    );
    expect(pickedReminder(null, "2026-01-31T09:00:00", "none", now)).toEqual({
      time: "2026-01-31T09:00:00",
      recurrence: "none",
    });
  });
});

describe("instantOf", () => {
  const at = (iso: string) => Date.parse(iso);

  it("reads a wall-clock time in the zone the reminder was made in", () => {
    expect(instantOf("2026-01-15T08:00:00", "Europe/Helsinki")).toBe(
      at("2026-01-15T06:00:00Z"),
    );
    expect(instantOf("2026-07-15T08:00:00", "Europe/Helsinki")).toBe(
      at("2026-07-15T05:00:00Z"),
    );
    expect(instantOf("2026-07-15T08:00:00", "America/New_York")).toBe(
      at("2026-07-15T12:00:00Z"),
    );
    expect(instantOf("2026-07-15T08:00:00", "UTC")).toBe(
      at("2026-07-15T08:00:00Z"),
    );
    expect(instantOf("2026-07-15T08:00", "Asia/Kolkata")).toBe(
      at("2026-07-15T02:30:00Z"),
    );
  });

  it("is right on both sides of a daylight saving change", () => {
    // Helsinki leaves summer time at 04:00 on 25 October 2026.
    expect(instantOf("2026-10-25T02:30:00", "Europe/Helsinki")).toBe(
      at("2026-10-24T23:30:00Z"),
    );
    expect(instantOf("2026-10-25T05:00:00", "Europe/Helsinki")).toBe(
      at("2026-10-25T03:00:00Z"),
    );
    // And starts it at 03:00 on 29 March. 03:30 does not exist that night, and
    // goes to just after the gap.
    expect(instantOf("2026-03-29T02:59:00", "Europe/Helsinki")).toBe(
      at("2026-03-29T00:59:00Z"),
    );
    expect(instantOf("2026-03-29T03:30:00", "Europe/Helsinki")).toBe(
      at("2026-03-29T01:30:00Z"),
    );
    expect(instantOf("2026-03-29T04:00:00", "Europe/Helsinki")).toBe(
      at("2026-03-29T01:00:00Z"),
    );
  });

  it("falls back to the machine's zone for one it does not know", () => {
    expect(instantOf("2026-07-15T08:00:00", "Mars/Olympus")).toBe(
      new Date(2026, 6, 15, 8).getTime(),
    );
  });
});

describe("urgent reminders", () => {
  const local = (time: string) => parseLocalISO(time).getTime();
  const firedAt = "2026-10-03T09:00:00.000Z";

  it("stay at their time when they fire, where others move on", () => {
    const daily = { time: "2026-10-03T09:00:00", recurrence: "daily" as const };
    expect(afterFire({ ...daily, urgent: true as const }, firedAt)).toEqual({
      ...daily,
      urgent: true,
      lastFiredAt: firedAt,
    });
    expect(afterFire(daily, firedAt).time).toBe("2026-10-04T09:00:00");
  });

  it("fire next URGENT_REPEAT_MS after their last fire, until done", () => {
    const fired = {
      time: "2026-10-03T09:00:00",
      recurrence: "none" as const,
      urgent: true as const,
      lastFiredAt: firedAt,
    };
    expect(awaitsDone(fired)).toBe(true);
    expect(nextFireAt(fired, local)).toBe(
      Date.parse(firedAt) + URGENT_REPEAT_MS,
    );
    const { urgent: _plain, ...plain } = fired;
    expect(nextFireAt(plain, local)).toBeNull();
  });

  it("go past now to the next occurrence when done, or away", () => {
    const now = new Date(2026, 9, 6, 12);
    const done = reminderDone(
      {
        time: "2026-10-03T09:00:00",
        recurrence: "daily",
        urgent: true,
        lastFiredAt: firedAt,
      },
      now,
    );
    expect(done).toEqual({
      time: "2026-10-07T09:00:00",
      recurrence: "daily",
      urgent: true,
    });
    expect(
      reminderDone({ time: "2026-10-03T09:00:00", recurrence: "none" }, now),
    ).toBeNull();
  });
});
