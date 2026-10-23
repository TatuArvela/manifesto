import { awaitsDone, type Note, parseLocalISO } from "@manifesto/shared";

// The Reminders view in sections by time. It is pure, so that it can run in the
// Node test project. `views.ts` gives it the notes and the clock.

export const REMINDER_SECTIONS = [
  "overdue",
  "today",
  "tomorrow",
  "week",
  "later",
  "past",
] as const;

export type ReminderSection = (typeof REMINDER_SECTIONS)[number];

export interface ReminderSectionNotes {
  section: ReminderSection;
  notes: Note[];
}

const DAY_MS = 24 * 60 * 60_000;

/** Midnight of the day of `at`, on the clock of the device. */
function startOfDay(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

/**
 * The section of a reminder at `now`:
 *
 * - `overdue`: an urgent reminder that waits for "Done", or a time that went
 *   past and did not fire yet.
 * - `today`, `tomorrow`, `week` (the five days after tomorrow), `later`: by the
 *   day of the next fire.
 * - `past`: a one-time reminder that fired. It stays on its note until the user
 *   clears it.
 */
export function sectionOf(
  reminder: NonNullable<Note["reminder"]>,
  now: Date,
): ReminderSection {
  if (awaitsDone(reminder)) return "overdue";
  if (reminder.recurrence === "none" && reminder.lastFiredAt) return "past";
  const at = parseLocalISO(reminder.time);
  if (at.getTime() <= now.getTime()) return "overdue";
  // Days on the clock, not periods of 24 hours. A daylight saving change makes
  // one day 23 or 25 hours, and `round` absorbs that.
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return "week";
  return "later";
}

/**
 * The notes that have a reminder, in sections, in the order of
 * `REMINDER_SECTIONS`, without empty sections. In each section, urgent
 * reminders come first, then by time. The fired one-time reminders come newest
 * first, because the oldest are the least interesting.
 */
export function reminderSections(
  notes: Note[],
  now: Date,
): ReminderSectionNotes[] {
  const bySection = new Map<
    ReminderSection,
    { note: Note; at: number; urgent: boolean }[]
  >();
  for (const note of notes) {
    if (!note.reminder) continue;
    const section = sectionOf(note.reminder, now);
    const list = bySection.get(section) ?? [];
    list.push({
      note,
      at: parseLocalISO(note.reminder.time).getTime(),
      urgent: note.reminder.urgent === true,
    });
    bySection.set(section, list);
  }
  return REMINDER_SECTIONS.flatMap((section) => {
    const list = bySection.get(section);
    if (!list) return [];
    const direction = section === "past" ? -1 : 1;
    list.sort(
      (a, b) =>
        Number(b.urgent) - Number(a.urgent) || direction * (a.at - b.at),
    );
    return [{ section, notes: list.map(({ note }) => note) }];
  });
}
