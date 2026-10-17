import {
  advanceReminder,
  parseLocalISO,
  REMINDER_RECURRENCES,
  type ReminderRecurrence,
  snapReminderToFuture,
} from "@manifesto/shared";

// What the service worker decides about its own copy of the reminders, kept
// apart from `sw.ts` so it can be tested: that file runs Workbox as it loads.

export interface StoredReminder {
  noteId: string;
  time: string;
  recurrence: ReminderRecurrence;
  /** The day a monthly or yearly reminder repeats on, when `time` shows
   * another (`NoteReminder.day`). */
  day?: number;
  title: string;
  body: string;
  lastFiredAt: string | null;
}

export const DEDUPE_WINDOW_MS = 60_000;
export const POLL_INTERVAL_MS = 60_000;
// Matches reminderScheduler.ts: an occurrence more than an hour stale is not
// worth surfacing, it is only worth skipping past.
export const CATCHUP_WINDOW_MS = 60 * 60_000;

const VALID_RECURRENCES = new Set<string>(REMINDER_RECURRENCES);

/**
 * Whether a reminder a page sent can be stored. The worker runs privileged
 * and a list it is sent replaces the whole store, so every field is checked
 * before it is believed.
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
  /** Long missed: moved past every missed occurrence without a notification. */
  | { kind: "skip"; next: StoredReminder }
  | { kind: "fire" };

/** What to do with `item` at `now`. */
export function stepFor(item: StoredReminder, now: number): ReminderStep {
  // A non-recurring reminder fires exactly once. `nextOccurrence` returns null
  // for it, so its `time` stays in the past forever, and because
  // DEDUPE_WINDOW_MS equals POLL_INTERVAL_MS, the dedupe check below can never
  // suppress the *next* poll. Without this guard a dismissed reminder came
  // back every 60s indefinitely. Mirrors reminderScheduler.ts.
  if (item.recurrence === "none" && item.lastFiredAt) return { kind: "wait" };

  const dueMs = parseLocalISO(item.time).getTime() - now;
  if (dueMs > 0) return { kind: "wait" };

  // Long absence (device asleep, tab closed for days): advance a recurring
  // reminder past every missed occurrence silently, rather than replaying them
  // one per poll. A stale one-shot reminder is simply dropped, as on the client.
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
 * The reminder as stored once it has fired at `firedAt`: on to its next
 * occurrence, or marked fired when it does not repeat. `nextTime` is what the
 * pages are told.
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
