import type { NoteReminder } from "@manifesto/shared";
import { notes, updateNote } from "./state/actions.js";

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

  void (async () => {
    try {
      const isDev = import.meta.env.DEV;
      const base = import.meta.env.BASE_URL;
      await navigator.serviceWorker.register(
        isDev ? `${base}dev-sw.js?dev-sw` : `${base}sw.js`,
        { type: "module", scope: base },
      );
    } catch (err) {
      console.warn("Service worker registration failed:", err);
    }
  })();
}
