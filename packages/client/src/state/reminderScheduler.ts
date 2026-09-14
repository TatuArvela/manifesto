import type { Note, NoteReminder } from "@manifesto/shared";
import { signal } from "@preact/signals";
import { t } from "../i18n/index.js";
import { nextOccurrence, parseLocalISO, snapToFuture } from "./reminderTime.js";
import { showError } from "./ui.js";

export {
  currentTimezone,
  formatLocalISO,
  nextOccurrence,
  parseLocalISO,
  snapToFuture,
} from "./reminderTime.js";

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
    // periodicSync requires a permission grant on Chromium and isn't available
    // elsewhere, so fall back to the in-SW polling loop.
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

  // Rescheduled before the notification is out, not after: showing one through
  // the service worker is async, and a reschedule landing in that gap would
  // find the reminder still due and fire it again.
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
 * Shows a reminder as a system notification, reporting whether one appeared.
 *
 * Through the service worker wherever there is one. The page's own
 * `new Notification()` is what desktop browsers accept, but Chrome on Android
 * refuses it outright ("Illegal constructor") and an installed app on iOS has
 * no constructor at all, so on a phone every reminder the open app fired came
 * out as the in-app banner instead. A notification the worker shows is also
 * one it handles the click for (`notificationclick` in sw.ts), which opens the
 * note the same way.
 *
 * Assumes permission is granted; the caller has checked. Never rejects.
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
      // Fall through to the page's own notification.
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
    // Overdue: only catch up within the last hour to avoid spamming after long absences.
    if (dueMs > -CATCHUP_WINDOW_MS) {
      queueMicrotask(() => fire(note));
    } else if (reminder.recurrence !== "none") {
      // Very old recurring reminder → snap forward without firing.
      const snapped = snapToFuture(reminder.time, reminder.recurrence);
      updateNoteFn?.(note.id, { reminder: { ...reminder, time: snapped } });
    }
    return;
  }

  // `setTimeout` is clamped to ~24.8 days (2^31 ms), which is fine for our
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

/** Notifies the user once that permission was denied. */
export function notifyPermissionDenied() {
  if (permissionToastShown) return;
  permissionToastShown = true;
  showError(t("reminder.permissionDenied"));
}
