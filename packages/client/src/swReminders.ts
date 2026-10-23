import {
  afterFire,
  awaitsDone,
  nextFireAt,
  parseLocalISO,
  REMINDER_RECURRENCES,
  type ReminderRecurrence,
  reminderDone,
  snapReminderToFuture,
} from "@manifesto/shared";

// What the service worker decides about its own copy of the reminders, kept
// separate from `sw.ts` so that it can be tested. That file runs Workbox when
// it loads.

export interface StoredReminder {
  noteId: string;
  time: string;
  recurrence: ReminderRecurrence;
  /**
   * The day on which a monthly or yearly reminder repeats, when `time` shows a
   * different day (`NoteReminder.day`).
   */
  day?: number;
  title: string;
  body: string;
  lastFiredAt: string | null;
  /** `NoteReminder.urgent`. */
  urgent?: true;
  /**
   * The words of the "Done" button of an urgent notification, in the language
   * of the page. The worker has no catalogue.
   */
  doneLabel?: string;
}

export const DEDUPE_WINDOW_MS = 60_000;
export const POLL_INTERVAL_MS = 60_000;
// Agrees with reminderScheduler.ts. An occurrence more than one hour old is not
// worth a notification. The code only skips it.
export const CATCHUP_WINDOW_MS = 60 * 60_000;

const VALID_RECURRENCES = new Set<string>(REMINDER_RECURRENCES);

/**
 * If a reminder that a page sent can be stored. The worker runs with
 * privileges, and a list that it gets replaces the full store. Thus, the code
 * checks each field before it believes it.
 */
export function isValidStoredReminder(value: unknown): value is StoredReminder {
  if (!value || typeof value !== "object") return false;
  const reminder = value as Record<string, unknown>;
  if (typeof reminder.noteId !== "string" || !reminder.noteId) return false;
  if (typeof reminder.time !== "string") return false;
  if (Number.isNaN(new Date(reminder.time).getTime())) return false;
  if (
    typeof reminder.recurrence !== "string" ||
    !VALID_RECURRENCES.has(reminder.recurrence)
  ) {
    return false;
  }
  if (
    reminder.day !== undefined &&
    !(
      Number.isInteger(reminder.day) &&
      Number(reminder.day) >= 1 &&
      Number(reminder.day) <= 31
    )
  ) {
    return false;
  }
  if (typeof reminder.title !== "string") return false;
  if (typeof reminder.body !== "string") return false;
  if (
    reminder.lastFiredAt !== null &&
    typeof reminder.lastFiredAt !== "string"
  ) {
    return false;
  }
  if (reminder.urgent !== undefined && reminder.urgent !== true) return false;
  if (
    reminder.doneLabel !== undefined &&
    !(typeof reminder.doneLabel === "string" && reminder.doneLabel.length <= 40)
  ) {
    return false;
  }
  return true;
}

/** What a look at the list does with one reminder. */
export type ReminderStep =
  | { kind: "wait" }
  /**
   * Missed long ago: moved past each missed occurrence without a notification.
   */
  | { kind: "skip"; next: StoredReminder }
  | { kind: "fire" };

/** What to do with `item` at `now`. */
export function stepFor(item: StoredReminder, now: number): ReminderStep {
  // A non-recurring reminder fires exactly one time. `nextOccurrence` returns
  // null for it. Thus, its `time` stays in the past forever. Because
  // DEDUPE_WINDOW_MS is equal to POLL_INTERVAL_MS, the dedupe check below can
  // never stop the *next* poll. Without this guard, a dismissed reminder came
  // back each 60s forever. The same as in reminderScheduler.ts. An urgent
  // reminder that fired waits for the user, and fires again each
  // URGENT_REPEAT_MS until they mark it done.
  const fireAt = nextFireAt(item, (time) => parseLocalISO(time).getTime());
  if (fireAt === null) return { kind: "wait" };
  const dueMs = fireAt - now;
  if (dueMs > 0) return { kind: "wait" };
  if (awaitsDone(item)) return { kind: "fire" };

  // A long absence (the device was asleep, the tab was closed for days):
  // silently move a recurring reminder past each missed occurrence, and do not
  // play them again one for each poll. A stale one-time reminder is dropped, as
  // on the client.
  if (dueMs < -CATCHUP_WINDOW_MS && !item.urgent) {
    return item.recurrence === "none"
      ? { kind: "wait" }
      : { kind: "skip", next: snapReminderToFuture(item, new Date(now)) };
  }

  if (
    item.lastFiredAt &&
    now - new Date(item.lastFiredAt).getTime() < DEDUPE_WINDOW_MS
  ) {
    return { kind: "wait" };
  }
  return { kind: "fire" };
}

/**
 * The reminder as stored after it fired at `firedAt`: moved to its next
 * occurrence, or marked fired when it does not repeat or is urgent. The pages
 * get `nextTime`.
 */
export function afterFiring(
  item: StoredReminder,
  firedAt: string,
): { stored: StoredReminder; nextTime: string | null } {
  const { lastFiredAt: _previous, ...rest } = item;
  const fired = afterFire(rest, firedAt);
  return {
    stored: { ...fired, lastFiredAt: firedAt },
    nextTime: fired.time === item.time ? null : fired.time,
  };
}

/**
 * The copy of the worker after the user marked the reminder done from its
 * notification: its next occurrence, or null (remove it) when it does not
 * repeat.
 */
export function afterDone(
  item: StoredReminder,
  now: number,
): StoredReminder | null {
  const { lastFiredAt: _done, ...rest } = item;
  const next = reminderDone(rest, new Date(now));
  return next && { ...next, lastFiredAt: null };
}
