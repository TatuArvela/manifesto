import {
  advanceReminder,
  parseLocalISO,
  REMINDER_RECURRENCES,
  type ReminderRecurrence,
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
  // back each 60s forever. The same as in reminderScheduler.ts.
  if (item.recurrence === "none" && item.lastFiredAt) return { kind: "wait" };

  const dueMs = parseLocalISO(item.time).getTime() - now;
  if (dueMs > 0) return { kind: "wait" };

  // A long absence (the device was asleep, the tab was closed for days):
  // silently move a recurring reminder past each missed occurrence, and do not
  // play them again one for each poll. A stale one-time reminder is dropped, as
  // on the client.
  if (dueMs < -CATCHUP_WINDOW_MS) {
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
 * occurrence, or marked fired when it does not repeat. The pages get
 * `nextTime`.
 */
export function afterFiring(
  item: StoredReminder,
  firedAt: string,
): { stored: StoredReminder; nextTime: string | null } {
  const next = advanceReminder(item);
  return {
    stored: { ...(next ?? item), lastFiredAt: firedAt },
    nextTime: next?.time ?? null,
  };
}
