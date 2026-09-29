import type { NoteReminder, ReminderRecurrence } from "@manifesto/shared";

export function currentTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function parseLocalISO(iso: string): Date {
  const m = iso.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!m) return new Date(iso);
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  );
}

export function formatLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
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
  const src = parseLocalISO(time);
  const y = src.getFullYear();
  const mo = src.getMonth();
  const d = day ?? src.getDate();
  const h = src.getHours();
  const mi = src.getMinutes();
  const s = src.getSeconds();
  let next: Date;
  switch (recurrence) {
    case "daily":
      next = new Date(y, mo, d + 1, h, mi, s);
      break;
    case "weekly":
      next = new Date(y, mo, d + 7, h, mi, s);
      break;
    case "monthly": {
      const targetMonth = mo + 1;
      const lastDay = new Date(y, targetMonth + 1, 0).getDate();
      next = new Date(y, targetMonth, Math.min(d, lastDay), h, mi, s);
      break;
    }
    case "yearly": {
      const lastDay = new Date(y + 1, mo + 1, 0).getDate();
      next = new Date(y + 1, mo, Math.min(d, lastDay), h, mi, s);
      break;
    }
  }
  return formatLocalISO(next);
}

export function snapToFuture(
  time: string,
  recurrence: ReminderRecurrence,
  now: Date = new Date(),
  day?: number,
): string {
  if (recurrence === "none") return time;
  let current = time;
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
