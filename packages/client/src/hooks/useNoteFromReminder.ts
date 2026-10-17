import { useEffect } from "preact/hooks";
import { editingNoteId } from "#/state/ui.ts";

/**
 * Opens the note a reminder is about: one whose notification is tapped while
 * the app is open (`reminder:open-note`, from the page's own notification
 * or the service worker's, by way of `serviceWorker.ts`), and
 * one tapped with no window open, which starts the app on `?note=<id>`
 * (`sw.ts`). That one is taken once and removed from the address, so a
 * reload does not open the note again.
 */
export function useNoteFromReminder(): void {
  useEffect(() => {
    const openHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ noteId: string }>).detail;
      if (detail?.noteId) editingNoteId.value = detail.noteId;
    };
    window.addEventListener("reminder:open-note", openHandler);
    const launchUrl = new URL(window.location.href);
    const launchNoteId = launchUrl.searchParams.get("note");
    if (launchNoteId) {
      editingNoteId.value = launchNoteId;
      launchUrl.searchParams.delete("note");
      history.replaceState(history.state, "", launchUrl.href);
    }
    return () => {
      window.removeEventListener("reminder:open-note", openHandler);
    };
  }, []);
}
