import type { Note, NoteReminder } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { reminderSections, sectionOf } from "./reminderSections.ts";

// Wednesday, 14:00 on the clock of the device.
const NOW = new Date(2026, 9, 21, 14, 0);

function at(time: string, overrides: Partial<NoteReminder> = {}): NoteReminder {
  return { time, recurrence: "none", timezone: "UTC", ...overrides };
}

function note(id: string, reminder: NoteReminder | null): Note {
  return { id, reminder } as Note;
}

describe("sectionOf", () => {
  it("reads the day of the next fire on the clock", () => {
    expect(sectionOf(at("2026-10-21T13:00:00"), NOW)).toBe("overdue");
    expect(sectionOf(at("2026-10-21T23:59:00"), NOW)).toBe("today");
    expect(sectionOf(at("2026-10-22T00:00:00"), NOW)).toBe("tomorrow");
    expect(sectionOf(at("2026-10-27T23:00:00"), NOW)).toBe("week");
    expect(sectionOf(at("2026-10-28T08:00:00"), NOW)).toBe("later");
  });

  it("puts a fired one-time reminder in past, and an urgent one that waits in overdue", () => {
    const fired = { lastFiredAt: "2026-10-21T08:00:00.000Z" };
    expect(sectionOf(at("2026-10-21T08:00:00", fired), NOW)).toBe("past");
    expect(
      sectionOf(at("2026-10-21T08:00:00", { ...fired, urgent: true }), NOW),
    ).toBe("overdue");
  });
});

describe("reminderSections", () => {
  it("keeps the order of the sections, drops the empty ones, and puts urgent first", () => {
    const sections = reminderSections(
      [
        note("later", at("2026-11-01T08:00:00")),
        note("today-late", at("2026-10-21T20:00:00")),
        note("today-urgent", at("2026-10-21T21:00:00", { urgent: true })),
        note("today-early", at("2026-10-21T15:00:00")),
        note("none", null),
      ],
      NOW,
    );
    expect(
      sections.map(({ section, notes }) => [section, notes.map((n) => n.id)]),
    ).toEqual([
      ["today", ["today-urgent", "today-early", "today-late"]],
      ["later", ["later"]],
    ]);
  });
});
