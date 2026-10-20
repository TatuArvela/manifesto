import { useEffect } from "preact/hooks";
import { editingNoteId } from "#/state/ui.ts";

/**
 * Opens the note of a reminder. One case is a note whose notification is tapped
 * while the app is open (`reminder:open-note`, from the own notification of the
 * page or from the service worker, through `serviceWorker.ts`). The other case
 * is a note tapped with no window open, which starts the app on `?note=<id>`
 * (`sw.ts`). The code takes that one time, and removes it from the address.
 * Thus, a reload does not open the note again.
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
