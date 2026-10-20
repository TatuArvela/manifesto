import type { Note, NoteReminder } from "@manifesto/shared";
import {
  advanceReminder,
  parseLocalISO,
  snapReminderToFuture,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { t } from "#/i18n/index.ts";
import { showError } from "./ui.ts";

export {
  currentTimezone,
  formatLocalISO,
  nextOccurrence,
  parseLocalISO,
  pickedReminder,
  snapToFuture,
} from "@manifesto/shared";

// --- Public signals ---

/** Reminder fires that the app must render as an in-app banner. */
export const reminderBanner = signal<{
  noteId: string;
  title: string;
  body: string;
} | null>(null);

// --- Internal state ---

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const DEDUPE_WINDOW_MS = 60_000;
const CATCHUP_WINDOW_MS = 60 * 60_000;

// A back-reference to `updateNote`, injected at init to prevent a cycle.
let updateNoteFn:
  | ((id: string, changes: { reminder: NoteReminder }) => void)
  | null = null;
// A back-reference to the current notes list.
let getNotesFn: (() => Note[]) | null = null;

// --- Permission ---

let permissionToastShown = false;

export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    const result = await Notification.requestPermission();
    if (result === "granted") void registerPeriodicSync();
    return result;
  } catch {
    return "denied";
  }
}

async function registerPeriodicSync(): Promise<void> {
  if (typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = (await navigator.serviceWorker
      .ready) as ServiceWorkerRegistration & {
      periodicSync?: {
        register: (
          tag: string,
          options: { minInterval: number },
        ) => Promise<void>;
      };
    };
    if (!reg.periodicSync) return;
    await reg.periodicSync.register("check-reminders", {
      minInterval: 15 * 60_000,
    });
  } catch {
    // periodicSync needs a permission grant on Chromium, and is not available
    // in other places. Thus, use the polling loop in the service worker.
  }
}

// --- Firing ---

function fire(note: Note) {
  const reminder = note.reminder;
  if (!reminder) return;

  // Remove duplicates: skip if the same note fired within the last minute (this
  // handles races in the service worker).
  if (reminder.lastFiredAt) {
    const lastMs = new Date(reminder.lastFiredAt).getTime();
    if (Number.isFinite(lastMs) && Date.now() - lastMs < DEDUPE_WINDOW_MS) {
      return;
    }
  }

  const title = note.title.trim() || t("reminder.untitled");
  const body = note.content.replace(/\s+/g, " ").trim().slice(0, 140);

  // Scheduled again before the notification is out, not after. To show one
  // through the service worker is asynchronous. A new schedule in that gap
  // would find the reminder still due, and fire it again.
  scheduleNext(note, reminder);

  const showBanner = () => {
    reminderBanner.value = { noteId: note.id, title, body };
  };
  if (
    typeof Notification !== "undefined" &&
    Notification.permission === "granted"
  ) {
    void showReminderNotification(note.id, title, body).then((shown) => {
      if (!shown) showBanner();
    });
  } else {
    showBanner();
  }
}

/**
 * Shows a reminder as a system notification, and reports if one showed.
 *
 * Through the service worker wherever there is one. Desktop browsers accept the
 * own `new Notification()` of the page. But Chrome on Android refuses it
 * ("Illegal constructor"), and an installed app on iOS has no constructor.
 * Thus, on a phone, each reminder that the open app fired showed as the in-app
 * banner. The worker also handles the click for a notification that it shows
 * (`notificationclick` in sw.ts), which opens the note in the same way.
 *
 * Thinks that permission is given, because the caller checked. Never rejects.
 */
export async function showReminderNotification(
  noteId: string,
  title: string,
  body: string,
): Promise<boolean> {
  const registration =
    typeof navigator !== "undefined" && navigator.serviceWorker
      ? await navigator.serviceWorker.getRegistration().catch(() => undefined)
      : undefined;
  if (registration) {
    try {
      await registration.showNotification(title, {
        body,
        tag: noteId,
        data: { noteId },
      });
      return true;
    } catch {
      // Continue to the own notification of the page.
    }
  }
  if (typeof Notification === "undefined") return false;
  try {
    const n = new Notification(title, { body, tag: noteId });
    n.onclick = () => {
      window.focus();
      window.dispatchEvent(
        new CustomEvent("reminder:open-note", { detail: { noteId } }),
      );
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

function scheduleNext(note: Note, reminder: NoteReminder) {
  const nowIso = new Date().toISOString();
  const next = advanceReminder(reminder);
  const updated: NoteReminder = { ...(next ?? reminder), lastFiredAt: nowIso };
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

  // Non-recurring reminders stay visible after they fire, but must not fire
  // again.
  if (reminder.recurrence === "none" && reminder.lastFiredAt) return;

  const dueMs = parseLocalISO(reminder.time).getTime() - Date.now();

  if (dueMs <= 0) {
    // Overdue: catch up only within the last hour. Thus, after a long absence,
    // the app does not show too many notifications.
    if (dueMs > -CATCHUP_WINDOW_MS) {
      queueMicrotask(() => fire(note));
    } else if (reminder.recurrence !== "none") {
      // A very old recurring reminder: move it forward, and do not fire.
      updateNoteFn?.(note.id, { reminder: snapReminderToFuture(reminder) });
    }
    return;
  }

  // `setTimeout` is clamped to approximately 24.8 days (2^31 ms), which is
  // sufficient for our expected horizon. A new schedule starts each time that
  // `notes` changes or the visibility of the tab changes.
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
  syncToServiceWorker(all);
}

// --- Service-worker sync ---

let lastSyncSerialized = "";

function syncToServiceWorker(all: Note[]) {
  if (typeof navigator === "undefined") return;
  const sw = navigator.serviceWorker;
  if (!sw?.controller) return;
  const payload = all.flatMap((n) => {
    if (!n.reminder || n.trashed) return [];
    return [
      {
        noteId: n.id,
        time: n.reminder.time,
        recurrence: n.reminder.recurrence,
        ...(n.reminder.day !== undefined && { day: n.reminder.day }),
        title: n.title.trim() || t("reminder.untitled"),
        body: n.content.replace(/\s+/g, " ").trim().slice(0, 140),
        lastFiredAt: n.reminder.lastFiredAt ?? null,
      },
    ];
  });
  const serialized = JSON.stringify(payload);
  if (serialized === lastSyncSerialized) return;
  lastSyncSerialized = serialized;
  sw.controller.postMessage({ type: "sync-reminders", reminders: payload });
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

/** Tells the user one time that permission was refused. */
export function notifyPermissionDenied() {
  if (permissionToastShown) return;
  permissionToastShown = true;
  showError(t("reminder.permissionDenied"));
}
