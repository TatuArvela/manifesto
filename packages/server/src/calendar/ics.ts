import type { Note, NoteReminder, ReminderRecurrence } from "@manifesto/shared";

/**
 * A user's reminders as an iCalendar feed (RFC 5545), for a calendar app to
 * subscribe to: one event per note with a reminder, at its time in its
 * timezone, repeating as it does, with an alarm when it is due.
 *
 * Written by hand rather than with a library: the feed is one read-only
 * calendar of simple events, and the rules that matter (escaping, line
 * folding, CRLF) fit on a page.
 */

const RRULES: Record<ReminderRecurrence, string | null> = {
  none: null,
  daily: "FREQ=DAILY",
  weekly: "FREQ=WEEKLY",
  monthly: "FREQ=MONTHLY",
  yearly: "FREQ=YEARLY",
};

/**
 * The RRULE for a reminder. `FREQ=MONTHLY` alone repeats on the start date
 * and skips a month that has none (RFC 5545 3.3.10), where the app fires on
 * the month's last day instead. So a monthly or yearly reminder past the 28th
 * asks for the last of the days from the 28th to its own (`BYSETPOS=-1`):
 * its day where the month has it, the month's last day where it does not.
 */
export function rruleOf(
  reminder: Pick<NoteReminder, "time" | "recurrence" | "day">,
): string | null {
  const base = RRULES[reminder.recurrence] ?? null;
  if (reminder.recurrence !== "monthly" && reminder.recurrence !== "yearly") {
    return base;
  }
  const date = /^\d{4}-(\d{2})-(\d{2})/.exec(reminder.time);
  if (!date) return base;
  const day = reminder.day ?? Number(date[2]);
  if (!Number.isInteger(day) || day <= 28 || day > 31) return base;
  const days = Array.from({ length: day - 27 }, (_, i) => 28 + i).join(",");
  const month =
    reminder.recurrence === "yearly" ? `;BYMONTH=${Number(date[1])}` : "";
  return `${base}${month};BYMONTHDAY=${days};BYSETPOS=-1`;
}

/** How long an event is drawn; a reminder is a moment, but a calendar needs
 * something to show. */
const EVENT_DURATION = "PT15M";

/** Most of a note's text put in an event's description. */
const MAX_DESCRIPTION = 2000;

/** TEXT values escape backslash, semicolon, comma and line breaks. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Folds a content line at 75 octets, as the RFC asks, continuing with a
 * space. Counted in UTF-8 bytes, and never inside a character.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** `20260501T090000Z` for a moment in UTC. */
function utcStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** An IANA zone name as a TZID can carry it; anything else is refused. */
function safeTimezone(tz: string): string | null {
  return /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(tz) ? tz : null;
}

/**
 * DTSTART for a reminder: its wall-clock time in its timezone when both read
 * as they should, the moment in UTC when the time carries its own offset, and
 * nothing when it is neither.
 */
function startOf(time: string, timezone: string): string | null {
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    time,
  );
  if (local) {
    const [, y, mo, d, h, mi, s = "00"] = local;
    const stamp = `${y}${mo}${d}T${h}${mi}${s}`;
    const tz = safeTimezone(timezone);
    // Without a zone the calendar shows it at that clock time wherever the
    // reader is, which is what a reminder without one meant anyway.
    return tz ? `DTSTART;TZID=${tz}:${stamp}` : `DTSTART:${stamp}`;
  }
  const moment = Date.parse(time);
  if (Number.isNaN(moment)) return null;
  return `DTSTART:${utcStamp(new Date(moment))}`;
}

function summaryOf(note: Note): string {
  const title = note.title.trim();
  if (title) return title;
  const firstLine = note.content
    .split("\n")
    .map((line) => line.replace(/^[#>*\-\s[\]x]+/i, "").trim())
    .find((line) => line.length > 0);
  return firstLine?.slice(0, 200) ?? "";
}

export interface CalendarOptions {
  /** The calendar's name in the subscribing app. */
  name: string;
  /** Written as each event's DTSTAMP. */
  now: Date;
  /** The app's address, for a link in each event; null for none. */
  appUrl: string | null;
  /** What an untitled, empty note's event is called. */
  untitled: string;
}

/** The feed: every note with a reminder that is not in the trash. */
export function remindersCalendar(
  notes: Note[],
  options: CalendarOptions,
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//manifesto//reminders//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(options.name)}`,
  ];
  const stamp = utcStamp(options.now);
  for (const note of notes) {
    const reminder = note.reminder;
    if (!reminder || note.trashed) continue;
    const start = startOf(reminder.time, reminder.timezone);
    if (!start) continue;
    const summary = escapeText(summaryOf(note) || options.untitled);
    const rrule = rruleOf(reminder);
    const description = note.content.trim().slice(0, MAX_DESCRIPTION);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${note.id}@manifesto`,
      `DTSTAMP:${stamp}`,
      start,
      `DURATION:${EVENT_DURATION}`,
      `SUMMARY:${summary}`,
      ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
      ...(options.appUrl ? [`URL:${options.appUrl}`] : []),
      ...(rrule ? [`RRULE:${rrule}`] : []),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:PT0S",
      `DESCRIPTION:${summary}`,
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
