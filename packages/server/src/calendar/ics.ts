import type { Note, NoteReminder, ReminderRecurrence } from "@manifesto/shared";

/**
 * The reminders of a user as an iCalendar feed (RFC 5545), to which a calendar
 * app subscribes. There is one event for each note with a reminder, at its time
 * in its timezone, with the same repetition, and an alarm when it is due.
 *
 * We wrote it here, and did not use a library. The feed is one read-only
 * calendar of simple events, and the important rules (escaping, line folding,
 * CRLF) fit on a page.
 */

const RRULES: Record<ReminderRecurrence, string | null> = {
  none: null,
  daily: "FREQ=DAILY",
  weekly: "FREQ=WEEKLY",
  monthly: "FREQ=MONTHLY",
  yearly: "FREQ=YEARLY",
};

/**
 * The RRULE for a reminder. `FREQ=MONTHLY` alone repeats on the start date, and
 * skips a month that does not have it (RFC 5545 3.3.10). The app fires on the
 * last day of the month in that case. Thus, a monthly or yearly reminder after
 * the 28th asks for the last of the days from the 28th to its own day
 * (`BYSETPOS=-1`): its day where the month has it, and the last day of the
 * month where the month does not.
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

/**
 * The duration of an event. A reminder is a moment, but a calendar needs
 * something to show.
 */
const EVENT_DURATION = "PT15M";

/** The maximum amount of the text of a note in the description of an event. */
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
 * Folds a content line at 75 octets, as the RFC asks, and continues with a
 * space. It counts UTF-8 bytes, and never breaks a character.
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

/** An IANA zone name as a TZID can contain it. All other values are refused. */
function safeTimezone(tz: string): string | null {
  return /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(tz) ? tz : null;
}

/**
 * DTSTART for a reminder: its wall-clock time in its timezone when both read
 * correctly, the moment in UTC when the time contains its own offset, and
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
    // Without a zone, the calendar shows it at that clock time wherever the
    // reader is. That is also the meaning of a reminder without a zone.
    return tz ? `DTSTART;TZID=${tz}:${stamp}` : `DTSTART:${stamp}`;
  }
  const moment = Date.parse(time);
  if (Number.isNaN(moment)) return null;
  return `DTSTART:${utcStamp(new Date(moment))}`;
}

/** What the feed reads of a note. */
export type CalendarNote = Pick<
  Note,
  "id" | "title" | "content" | "reminder" | "trashed"
>;

function summaryOf(note: CalendarNote): string {
  const title = note.title.trim();
  if (title) return title;
  const firstLine = note.content
    .split("\n")
    .map((line) => line.replace(/^[#>*\-\s[\]x]+/i, "").trim())
    .find((line) => line.length > 0);
  return firstLine?.slice(0, 200) ?? "";
}

export interface CalendarOptions {
  /** The name of the calendar in the app that subscribes. */
  name: string;
  /** Written as the DTSTAMP of each event. */
  now: Date;
  /** The address of the app, for a link in each event. Null for none. */
  appUrl: string | null;
  /** The name of the event of an untitled, empty note. */
  untitled: string;
}

/** The feed: each note with a reminder that is not in the trash. */
export function remindersCalendar(
  notes: CalendarNote[],
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
      // RFC 5545: 1 is the highest priority.
      ...(reminder.urgent ? ["PRIORITY:1"] : []),
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
