import type { NoteReminder } from "@manifesto/shared";
import { reminderAt } from "@manifesto/shared";
import { SHARE_CACHE } from "./shareTarget.ts";
import { notes, updateNote } from "./state/notesStore.ts";
import { createUpdateReloader, pageIsIdle } from "./utils/updateReload.ts";

interface SwMessage {
  type: "reminder-fired" | "open-note";
  noteId?: string;
  nextTime?: string | null;
}

export function registerServiceWorker(): void {
  if (typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data as SwMessage | undefined;
    if (!data) return;
    if (data.type === "reminder-fired" && data.noteId) {
      const note = notes.value.find((n) => n.id === data.noteId);
      if (!note?.reminder) return;
      // The worker tells when. The own reminder of the note keeps the day on
      // which it repeats, because the copy of the worker can be older.
      const updated: NoteReminder = {
        ...(data.nextTime
          ? reminderAt(note.reminder, data.nextTime)
          : note.reminder),
        lastFiredAt: new Date().toISOString(),
      };
      void updateNote(note.id, { reminder: updated });
    } else if (data.type === "open-note" && data.noteId) {
      window.dispatchEvent(
        new CustomEvent("reminder:open-note", {
          detail: { noteId: data.noteId },
        }),
      );
    }
  });

  const reloader = createUpdateReloader({
    hadController: navigator.serviceWorker.controller !== null,
    isIdle: () => pageIsIdle(),
    reload: () => window.location.reload(),
  });
  navigator.serviceWorker.addEventListener("controllerchange", () =>
    reloader.controllerChanged(),
  );

  void (async () => {
    try {
      const isDev = import.meta.env.DEV;
      const base = import.meta.env.BASE_URL;
      const registration = await navigator.serviceWorker.register(
        isDev ? `${base}dev-sw.js?dev-sw` : `${base}sw.js`,
        { type: "module", scope: base },
      );
      keepCheckingForUpdates(registration, reloader);
    } catch (err) {
      console.warn("Service worker registration failed:", err);
    }
  })();
}

const UPDATE_CHECK_INTERVAL_MS = 60 * 60_000;

/**
 * The browser looks for a new worker on navigation, and an installed app that
 * resumes from the background never navigates. Thus, look each time the app
 * comes back to the foreground, and each hour while it stays there.
 */
function keepCheckingForUpdates(
  registration: ServiceWorkerRegistration,
  reloader: ReturnType<typeof createUpdateReloader>,
): void {
  const check = () => {
    registration.update().catch(() => {
      // Offline, or the server is down. The next check tries again.
    });
  };
  document.addEventListener("visibilitychange", () => {
    reloader.visibilityChanged();
    if (document.visibilityState === "visible") check();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") check();
  }, UPDATE_CHECK_INTERVAL_MS);
}

/**
 * Removes the installed app and loads it again from the server. Use this when
 * an update is stuck, or a cached copy is broken, and a wait for the next
 * visibility change is not sufficient. The code unregisters the worker and
 * empties its caches. Thus, the reload asks the network for each file, and
 * installs a new worker. A shared item that still waits to be picked up stays.
 *
 * Refuses offline (returns false), because the page that it reloads would have
 * no source.
 */
export async function forceUpdateApp(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== SHARE_CACHE)
          .map((name) => caches.delete(name)),
      );
    }
  } catch (err) {
    // Reload in all cases. The network still serves the page in the same way.
    console.warn("Clearing the installed app failed:", err);
  }
  window.location.reload();
  return true;
}
