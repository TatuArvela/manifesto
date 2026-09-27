import type { NoteReminder } from "@manifesto/shared";
import { SHARE_CACHE } from "./shareTarget.js";
import { notes, updateNote } from "./state/notesStore.js";
import { createUpdateReloader, pageIsIdle } from "./utils/updateReload.js";

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
      const updated: NoteReminder = data.nextTime
        ? {
            ...note.reminder,
            time: data.nextTime,
            lastFiredAt: new Date().toISOString(),
          }
        : { ...note.reminder, lastFiredAt: new Date().toISOString() };
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
 * The browser looks for a new worker on navigation, and an installed app
 * resumed from the background never navigates. So look on every return to the
 * foreground, and hourly while it stays there.
 */
function keepCheckingForUpdates(
  registration: ServiceWorkerRegistration,
  reloader: ReturnType<typeof createUpdateReloader>,
): void {
  const check = () => {
    registration.update().catch(() => {
      // Offline, or the server is down: the next check tries again.
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
 * Throws away the installed app and loads it again from the server: the way
 * out when an update is stuck, or a cached copy is broken, and waiting for
 * the next visibility change will not do. The worker is unregistered and its
 * caches emptied, so the reload asks the network for every file and installs
 * a fresh worker. A shared item still waiting to be picked up is kept.
 *
 * Refuses offline (returns false), since the page it reloads onto would have
 * nowhere to come from.
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
    // Reload regardless: the network still serves the page the same way.
    console.warn("Clearing the installed app failed:", err);
  }
  window.location.reload();
  return true;
}
