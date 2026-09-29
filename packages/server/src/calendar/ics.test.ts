import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { escapeText, foldLine, remindersCalendar, rruleOf } from "./ics.js";

function note(overrides: Partial<Note>): Note {
  return {
    id: "01NOTE",
    title: "Dentist",
    content: "",
    color: NoteColor.Default,
    font: NoteFont.Default,
    pinned: false,
    archived: false,
    trashed: false,
    trashedAt: null,
    position: 0,
    tags: [],
    images: [],
    linkPreviews: [],
    reminder: {
      time: "2026-05-01T09:30:00",
      recurrence: "none",
      timezone: "Europe/Helsinki",
    },
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

const options = {
  name: "Reminders",
  now: new Date("2026-04-02T12:00:00.000Z"),
  appUrl: null,
  untitled: "Reminder",
};

/** The content lines, unfolded, without the CRLFs. */
function lines(ics: string): string[] {
  return ics.replace(/\r\n /g, "").split("\r\n").filter(Boolean);
}

describe("remindersCalendar", () => {
  it("writes one event per reminder, in its zone, with an alarm", () => {
    const ics = remindersCalendar([note({})], options);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(lines(ics)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//manifesto//reminders//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Reminders",
      "BEGIN:VEVENT",
      "UID:01NOTE@manifesto",
      "DTSTAMP:20260402T120000Z",
      "DTSTART;TZID=Europe/Helsinki:20260501T093000",
      "DURATION:PT15M",
      "SUMMARY:Dentist",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:PT0S",
      "DESCRIPTION:Dentist",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ]);
  });

  it("repeats as the reminder does, and leaves out the trash and notes without one", () => {
    const ics = remindersCalendar(
      [
        note({
          id: "weekly",
          reminder: {
            time: "2026-05-01T09:00",
            recurrence: "weekly",
            timezone: "UTC",
          },
        }),
        note({ id: "trashed", trashed: true }),
        note({ id: "none", reminder: null }),
      ],
      options,
    );
    const all = lines(ics);
    expect(all.filter((l) => l.startsWith("UID:"))).toEqual([
      "UID:weekly@manifesto",
    ]);
    expect(all).toContain("RRULE:FREQ=WEEKLY");
    expect(all).toContain("DTSTART;TZID=UTC:20260501T090000");
  });

  it("names an untitled note by its first line, and keeps a zone it cannot trust out", () => {
    const ics = remindersCalendar(
      [
        note({
          title: "",
          content: "- [ ] Call back, today\nmore",
          reminder: {
            time: "2026-05-01T09:00:00",
            recurrence: "none",
            timezone: 'Evil";X-INJECT:1',
          },
        }),
      ],
      options,
    );
    const all = lines(ics);
    expect(all).toContain("SUMMARY:Call back\\, today");
    expect(all).toContain("DTSTART:20260501T090000");
    expect(ics).not.toContain("X-INJECT");
    expect(all).toContain("DESCRIPTION:- [ ] Call back\\, today\\nmore");
  });
});

describe("rruleOf", () => {
  it("repeats plainly on a day every month has", () => {
    expect(
      rruleOf({ time: "2026-05-15T09:00:00", recurrence: "monthly" }),
    ).toBe("FREQ=MONTHLY");
    expect(rruleOf({ time: "2026-05-28T09:00:00", recurrence: "yearly" })).toBe(
      "FREQ=YEARLY",
    );
    expect(rruleOf({ time: "2026-05-31T09:00:00", recurrence: "weekly" })).toBe(
      "FREQ=WEEKLY",
    );
    expect(rruleOf({ time: "2026-05-31T09:00:00", recurrence: "none" })).toBe(
      null,
    );
  });

  // FREQ=MONTHLY alone would skip every month without a 31st, where the app
  // fires on the month's last day.
  it("takes a short month's last day for a day past the 28th, as the app does", () => {
    expect(
      rruleOf({ time: "2026-01-31T09:00:00", recurrence: "monthly" }),
    ).toBe("FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1");
    expect(
      rruleOf({ time: "2026-01-29T09:00:00", recurrence: "monthly" }),
    ).toBe("FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1");
    expect(rruleOf({ time: "2024-02-29T09:00:00", recurrence: "yearly" })).toBe(
      "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1",
    );
  });

  it("repeats on the day a reminder was set for, not the day a short month moved it to", () => {
    expect(
      rruleOf({ time: "2026-02-28T09:00:00", recurrence: "monthly", day: 31 }),
    ).toBe("FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1");
    expect(
      rruleOf({ time: "2025-02-28T09:00:00", recurrence: "yearly", day: 29 }),
    ).toBe("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1");
  });
});

describe("text in a feed", () => {
  it("escapes what iCalendar reserves, so text cannot start a line of its own", () => {
    expect(escapeText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
  });

  it("folds long lines at 75 octets without splitting a character", () => {
    const folded = foldLine(`SUMMARY:${"ä".repeat(60)}`);
    for (const part of folded.split("\r\n")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"ä".repeat(60)}`);
  });
});
