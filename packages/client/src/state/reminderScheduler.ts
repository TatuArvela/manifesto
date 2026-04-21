import type { Note, NoteReminder, ReminderRecurrence } from "@manifesto/shared";
import { signal } from "@preact/signals";
import { t } from "../i18n/index.js";
import { showError } from "./ui.js";

// --- Public signals ---

/** Reminder fires that the app needs to render as an in-app banner. */
export const reminderBanner = signal<{
  noteId: string;
  title: string;
  body: string;
} | null>(null);

// --- Internal state ---

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const DEDUPE_WINDOW_MS = 60_000;
const CATCHUP_WINDOW_MS = 60 * 60_000;

// Back-reference to `updateNote` injected at init to avoid a cycle.
let updateNoteFn:
  | ((id: string, changes: { reminder: NoteReminder }) => void)
  | null = null;
// Back-reference to current notes list.
let getNotesFn: (() => Note[]) | null = null;

// --- Date utilities ---

/** Get the current local IANA timezone. */
export function currentTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Parse a local-wall-clock ISO string (`YYYY-MM-DDTHH:mm:ss`) into a Date. */
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

/** Format a Date as `YYYY-MM-DDTHH:mm:ss` in local wall-clock (no TZ suffix). */
export function formatLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * Advance a reminder time by its recurrence, preserving local wall-clock
 * components (so 08:00 stays 08:00 across DST and short months clamp to
 * their last day). Returns `null` for `"none"`.
 */
export function nextOccurrence(
  time: string,
  recurrence: ReminderRecurrence,
): string | null {
  if (recurrence === "none") return null;
  const src = parseLocalISO(time);
  const y = src.getFullYear();
  const mo = src.getMonth();
  const d = src.getDate();
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
      // setDate clamps to the last day of the target month.
      const lastDay = new Date(y, targetMonth + 1, 0).getDate();
      next = new Date(y, targetMonth, Math.min(d, lastDay), h, mi, s);
      break;
    }
    case "yearly": {
      // Feb 29 on non-leap years → Feb 28.
      const lastDay = new Date(y + 1, mo + 1, 0).getDate();
      next = new Date(y + 1, mo, Math.min(d, lastDay), h, mi, s);
      break;
    }
  }
  return formatLocalISO(next);
}

/**
 * Snap a reminder time into the future for a recurring reminder that was
 * set with a past date. Returns the input unchanged if already in the future
 * or if `"none"`.
 */
export function snapToFuture(
  time: string,
  recurrence: ReminderRecurrence,
  now: Date = new Date(),
): string {
  if (recurrence === "none") return time;
  let current = time;
  while (parseLocalISO(current).getTime() <= now.getTime()) {
    const advanced = nextOccurrence(current, recurrence);
    if (!advanced) return current;
    current = advanced;
  }
  return current;
}

// --- Permission ---

let permissionToastShown = false;

export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

// --- Firing ---

function fire(note: Note) {
  const reminder = note.reminder;
  if (!reminder) return;

  // Dedupe: skip if the same note fired within the last minute (handles SW races).
  if (reminder.lastFiredAt) {
    const lastMs = new Date(reminder.lastFiredAt).getTime();
    if (Number.isFinite(lastMs) && Date.now() - lastMs < DEDUPE_WINDOW_MS) {
      return;
    }
  }

  const title = note.title.trim() || t("reminder.untitled");
  const body = note.content.replace(/\s+/g, " ").trim().slice(0, 140);

  let fired = false;
  if (
    typeof Notification !== "undefined" &&
    Notification.permission === "granted"
  ) {
    try {
      const n = new Notification(title, { body, tag: note.id });
      n.onclick = () => {
        window.focus();
        window.dispatchEvent(
          new CustomEvent("reminder:open-note", {
            detail: { noteId: note.id },
          }),
        );
        n.close();
      };
      fired = true;
    } catch {
      fired = false;
    }
  }

  if (!fired) {
    reminderBanner.value = { noteId: note.id, title, body };
  }

  scheduleNext(note, reminder);
}

function scheduleNext(note: Note, reminder: NoteReminder) {
  const nowIso = new Date().toISOString();
  const next = nextOccurrence(reminder.time, reminder.recurrence);
  const updated: NoteReminder = next
    ? { ...reminder, time: next, lastFiredAt: nowIso }
    : { ...reminder, lastFiredAt: nowIso };
  updateNoteFn?.(note.id, { reminder: updated });
}

// --- Scheduling loop ---

function clearAllTimers() {
  for (const handle of timers.values()) clearTimeout(handle);
  timers.clear();
}

function scheduleForNote(note: Note) {
  const reminder = note.reminder;
  if (!reminder) return;
  if (note.trashed) return;

  // Non-recurring reminders stay visible after firing but must not re-fire.
  if (reminder.recurrence === "none" && reminder.lastFiredAt) return;

  const dueMs = parseLocalISO(reminder.time).getTime() - Date.now();

  if (dueMs <= 0) {
    // Overdue — only catch up within the last hour to avoid spamming after long absences.
    if (dueMs > -CATCHUP_WINDOW_MS) {
      queueMicrotask(() => fire(note));
    } else if (reminder.recurrence !== "none") {
      // Very old recurring reminder → snap forward without firing.
      const snapped = snapToFuture(reminder.time, reminder.recurrence);
      updateNoteFn?.(note.id, { reminder: { ...reminder, time: snapped } });
    }
    return;
  }

  // `setTimeout` is clamped to ~24.8 days (2^31 ms) — that's fine for our
  // expected horizon; a reschedule is triggered whenever `notes` changes or
  // the tab visibility flips.
  const delay = Math.min(dueMs, 2_000_000_000);
  const handle = setTimeout(() => {
    const latest = getNotesFn?.().find((n) => n.id === note.id);
    if (latest) fire(latest);
  }, delay);
  timers.set(note.id, handle);
}

function reschedule(all: Note[]) {
  clearAllTimers();
  for (const note of all) {
    if (note.reminder && !note.trashed) scheduleForNote(note);
  }
}

// --- Public init ---

export interface SchedulerDeps {
  notes: () => Note[];
  subscribe: (listener: (notes: Note[]) => void) => () => void;
  updateNote: (id: string, changes: { reminder: NoteReminder }) => void;
}

let initialized = false;

export function initReminderScheduler(deps: SchedulerDeps): void {
  if (initialized) return;
  initialized = true;
  getNotesFn = deps.notes;
  updateNoteFn = deps.updateNote;

  deps.subscribe((all) => reschedule(all));
  reschedule(deps.notes());

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        reschedule(deps.notes());
      }
    });
  }
}

/** Notifies the user once that permission was denied. */
export function notifyPermissionDenied() {
  if (permissionToastShown) return;
  permissionToastShown = true;
  showError(t("reminder.permissionDenied"));
}
