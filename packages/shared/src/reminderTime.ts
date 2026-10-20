import type { NoteReminder, ReminderRecurrence } from "./note.ts";

// When a reminder is due, and its next time. It is pure. It is in the shared
// package because three parts must agree on it: the scheduler of the page, the
// service worker, and the server. The server sends a push for a reminder that
// no open client fired, and then moves it on as a client would.

export function currentTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** A local wall-clock time as its written parts. The month starts at zero. */
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
 * A date at a wall-clock time, written as given. The code normalizes the date
 * through a `Date` at noon, which no daylight saving change reaches. It keeps
 * the clock also on a day where that time does not exist (02:30 when the clocks
 * jump from 02:00 to 03:00). `parseLocalISO` then puts that one fire just after
 * the gap, and the next step starts from the own hour of the reminder again.
 * When the code read it back from a `Date`, the hour became 03 and stayed
 * there.
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
 * The occurrence after `time`. A monthly or yearly reminder goes to `day` (the
 * day for which it was set, by default the day of `time`), or to the last day
 * of a month that is too short for it. The next step starts from `day` again,
 * never from the clamped date. Thus, the 31st goes to 28 February and back to
 * 31 March.
 */
export function nextOccurrence(
  time: string,
  recurrence: ReminderRecurrence,
  day?: number,
): string | null {
  if (recurrence === "none") return null;
  const src = partsOf(time);
  const { y, mo } = src;
  // Only a step by date goes to `day`. A daily or weekly step starts from
  // `time` itself. `snapToFuture` sends the same `day` at each step.
  const d = day ?? src.d;
  switch (recurrence) {
    case "daily":
      return atClock(y, mo, src.d + 1, src);
    case "weekly":
      return atClock(y, mo, src.d + 7, src);
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
 * A daily or weekly reminder moved forward in full steps to the last step that
 * starts one day or more before `now`, in one operation, not one step at a
 * time. Those steps have a fixed length in days. A reminder that is years
 * behind would otherwise walk thousands of them. Monthly and yearly steps have
 * different lengths, and 1000 of them already cover 83 years.
 */
function skipAhead(
  time: string,
  recurrence: ReminderRecurrence,
  now: Date,
): string {
  const step = recurrence === "daily" ? 1 : recurrence === "weekly" ? 7 : 0;
  if (step === 0) return time;
  const from = partsOf(time);
  // Local calendar dates as day counts. Thus, they subtract in full days,
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
  // Limit the iterations, as a precaution. Thus, a nextOccurrence that does not
  // advance (for example, an edge case in the monthly clamp) can never lock the
  // tab.
  for (let i = 0; i < 1000; i++) {
    if (parseLocalISO(current).getTime() > now.getTime()) return current;
    const advanced = nextOccurrence(current, recurrence, day);
    if (!advanced || advanced === current) return current;
    current = advanced;
  }
  return current;
}

type Repeating = Pick<NoteReminder, "time" | "recurrence" | "day">;

/**
 * The day of the month on which a reminder repeats: the day for which it was
 * set.
 */
export function repeatDay(
  reminder: Pick<NoteReminder, "time" | "day">,
): number {
  return reminder.day ?? parseLocalISO(reminder.time).getDate();
}

/**
 * The reminder moved to `time`, with its repeat day. `day` is stored only while
 * `time` does not show it. Thus, a reminder that never meets a short month
 * never has one.
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

/**
 * The next occurrence of the reminder, or null for a reminder that does not
 * repeat.
 */
export function advanceReminder<T extends Repeating>(reminder: T): T | null {
  const next = nextOccurrence(
    reminder.time,
    reminder.recurrence,
    repeatDay(reminder),
  );
  return next === null ? null : reminderAt(reminder, next);
}

/** The reminder moved past each occurrence before `now`. None of them fired. */
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
 * What the picker saves for a date, hour and recurrence. A reminder that a
 * short month clamped (the 31st shown as 28 February) keeps the day on which it
 * repeats while only its hour changes. A new date or recurrence starts from the
 * selected date. A recurring time that is already past moves to its next
 * occurrence.
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

/**
 * The instant of a wall-clock `time` in `timezone`, as epoch milliseconds. The
 * `time` of a reminder has no zone. A browser reads it in the zone of the
 * device. The server is in a different zone. Thus, it must read it in the zone
 * where the reminder was made.
 *
 * `Intl` tells what the clock shows in a zone at an instant, not the opposite.
 * Thus, this function guesses the instant as if the time were UTC, and corrects
 * it by the offset of the zone there, two times. The second pass corrects a
 * guess that was on the other side of a daylight saving change. A time that the
 * clocks skip goes just after the gap, as `parseLocalISO` does on a device. An
 * unknown zone reads the time in the zone of the machine.
 */
export function instantOf(time: string, timezone: string): number {
  const { y, mo, d, h, mi, s } = partsOf(time);
  const asUtc = Date.UTC(y, mo, d, h, mi, s);
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
  } catch {
    return parseLocalISO(time).getTime();
  }
  /** How much the clock of the zone is ahead of UTC, at `instant`. */
  const offsetAt = (instant: number) => {
    const shown: Record<string, number> = {};
    for (const part of format.formatToParts(instant)) {
      if (part.type !== "literal") shown[part.type] = Number(part.value);
    }
    return (
      Date.UTC(
        shown.year ?? 0,
        (shown.month ?? 1) - 1,
        shown.day ?? 1,
        shown.hour ?? 0,
        shown.minute ?? 0,
        shown.second ?? 0,
      ) - instant
    );
  };
  const first = asUtc - offsetAt(asUtc);
  return asUtc - offsetAt(first);
}
