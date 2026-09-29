import type { NoteReminder, ReminderRecurrence } from "@manifesto/shared";

export function currentTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** A local wall-clock time as its written parts, month zero-based. */
interface ClockParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function partsOf(iso: string): ClockParts {
  const m = LOCAL_ISO.exec(iso);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
    return {
      y: Number(y),
      mo: Number(mo) - 1,
      d: Number(d),
      h: Number(h),
      mi: Number(mi),
      s: Number(s),
    };
  }
  const date = new Date(iso);
  return {
    y: date.getFullYear(),
    mo: date.getMonth(),
    d: date.getDate(),
    h: date.getHours(),
    mi: date.getMinutes(),
    s: date.getSeconds(),
  };
}

export function parseLocalISO(iso: string): Date {
  if (!LOCAL_ISO.test(iso)) return new Date(iso);
  const { y, mo, d, h, mi, s } = partsOf(iso);
  return new Date(y, mo, d, h, mi, s);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatLocalISO(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * A date at a wall-clock time, written as given. The date is normalised
 * through a `Date` at noon, which no daylight saving change reaches, and the
 * clock is kept even on a day it does not exist (02:30 when the clocks jump
 * from 02:00 to 03:00): `parseLocalISO` then lands that one fire just after
 * the gap, and the step after starts from the reminder's own hour again.
 * Read back from a `Date`, the hour came out as 03 and stayed there.
 */
function atClock(
  y: number,
  mo: number,
  d: number,
  { h, mi, s }: Pick<ClockParts, "h" | "mi" | "s">,
): string {
  const date = new Date(y, mo, d, 12);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(h)}:${pad(mi)}:${pad(s)}`
  );
}

/**
 * The occurrence after `time`. A monthly or yearly reminder lands on `day`
 * (the day it was set for, by default `time`'s own) or on the last day of a
 * month too short for it, and the next step starts from `day` again, never
 * from the clamped date: the 31st goes to 28 February and back to 31 March.
 */
export function nextOccurrence(
  time: string,
  recurrence: ReminderRecurrence,
  day?: number,
): string | null {
  if (recurrence === "none") return null;
  const src = partsOf(time);
  const { y, mo } = src;
  const d = day ?? src.d;
  switch (recurrence) {
    case "daily":
      return atClock(y, mo, d + 1, src);
    case "weekly":
      return atClock(y, mo, d + 7, src);
    case "monthly": {
      const lastDay = new Date(y, mo + 2, 0, 12).getDate();
      return atClock(y, mo + 1, Math.min(d, lastDay), src);
    }
    case "yearly": {
      const lastDay = new Date(y + 1, mo + 1, 0, 12).getDate();
      return atClock(y + 1, mo, Math.min(d, lastDay), src);
    }
  }
}

/**
 * A daily or weekly reminder moved forward in whole steps to the last one
 * that starts at least a day before `now`, at once rather than a step at a
 * time: those steps have a fixed length in days. One years behind would
 * otherwise walk thousands of them. Monthly and yearly steps vary in length,
 * and 1000 of them already span 83 years.
 */
function skipAhead(
  time: string,
  recurrence: ReminderRecurrence,
  now: Date,
): string {
  const step = recurrence === "daily" ? 1 : recurrence === "weekly" ? 7 : 0;
  if (step === 0) return time;
  const from = partsOf(time);
  // Local calendar dates as day counts, so they subtract in whole days
  // whatever daylight saving does between them.
  const days =
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(from.y, from.mo, from.d)) /
    86_400_000;
  const steps = Math.floor((days - 1) / step);
  if (steps <= 0) return time;
  return atClock(from.y, from.mo, from.d + steps * step, from);
}

export function snapToFuture(
  time: string,
  recurrence: ReminderRecurrence,
  now: Date = new Date(),
  day?: number,
): string {
  if (recurrence === "none") return time;
  let current = skipAhead(time, recurrence, now);
  // Cap iterations defensively so a non-advancing nextOccurrence (e.g. an edge
  // case in the monthly clamp) can never lock the tab.
  for (let i = 0; i < 1000; i++) {
    if (parseLocalISO(current).getTime() > now.getTime()) return current;
    const advanced = nextOccurrence(current, recurrence, day);
    if (!advanced || advanced === current) return current;
    current = advanced;
  }
  return current;
}

type Repeating = Pick<NoteReminder, "time" | "recurrence" | "day">;

/** The day of the month a reminder repeats on: the one it was set for. */
export function repeatDay(
  reminder: Pick<NoteReminder, "time" | "day">,
): number {
  return reminder.day ?? parseLocalISO(reminder.time).getDate();
}

/**
 * The reminder moved to `time`, keeping its repeat day. `day` is stored only
 * while `time` does not show it, so a reminder that never meets a short month
 * never carries one.
 */
export function reminderAt<T extends Repeating>(reminder: T, time: string): T {
  const day = repeatDay(reminder);
  const { day: _dropped, ...rest } = reminder;
  const repeatsByDate =
    reminder.recurrence === "monthly" || reminder.recurrence === "yearly";
  return repeatsByDate && parseLocalISO(time).getDate() !== day
    ? ({ ...rest, time, day } as T)
    : ({ ...rest, time } as T);
}

/** The reminder's next occurrence, or null for one that does not repeat. */
export function advanceReminder<T extends Repeating>(reminder: T): T | null {
  const next = nextOccurrence(
    reminder.time,
    reminder.recurrence,
    repeatDay(reminder),
  );
  return next === null ? null : reminderAt(reminder, next);
}

/** The reminder moved past every occurrence before `now`, none of them fired. */
export function snapReminderToFuture<T extends Repeating>(
  reminder: T,
  now: Date = new Date(),
): T {
  return reminderAt(
    reminder,
    snapToFuture(reminder.time, reminder.recurrence, now, repeatDay(reminder)),
  );
}

/**
 * What the picker saves for a date, hour and recurrence. A reminder a short
 * month has clamped (the 31st shown as 28 February) keeps the day it repeats
 * on while only its hour changes; a new date or recurrence starts from the
 * date picked. A recurring time already past moves to its next occurrence.
 */
export function pickedReminder(
  previous: Repeating | null,
  time: string,
  recurrence: ReminderRecurrence,
  now: Date = new Date(),
): Repeating {
  const keepsDay =
    previous?.day !== undefined &&
    previous.recurrence === recurrence &&
    previous.time.slice(0, 10) === time.slice(0, 10);
  const picked: Repeating = {
    time,
    recurrence,
    ...(keepsDay && { day: previous.day }),
  };
  return recurrence !== "none" && parseLocalISO(time).getTime() <= now.getTime()
    ? snapReminderToFuture(picked, now)
    : reminderAt(picked, time);
}
