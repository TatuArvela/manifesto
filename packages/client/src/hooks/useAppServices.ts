import { effect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { startAppSocket } from "#/realtime/appSocket.ts";
import { revealApp } from "#/splash.ts";
import { startAccountLocaleReport } from "#/state/account/accountLocale.ts";
import { isServerMode } from "#/state/account/auth.ts";
import { initAutoNotes } from "#/state/autoNotes.ts";
import { initBoardBackground } from "#/state/board.ts";
import { takeIncomingShare } from "#/state/incomingShare.ts";
import { loadNotes, notes, updateNote } from "#/state/notesStore.ts";
import { startPrefsSync } from "#/state/prefsSync.ts";
import { initReminderScheduler } from "#/state/reminderScheduler.ts";
import { initRouter } from "#/state/router.ts";
import { welcomeIfNew } from "#/state/welcome.ts";

/**
 * Starts what runs while the board is open: the router, the socket, the notes
 * and what the code calculates from them, and the first-visit checks. One time,
 * on mount. The board starts `loadEditor`, because it is a chunk, not a
 * service.
 */
export function useAppServices(): void {
  useEffect(() => {
    initRouter();
    startAppSocket();
    if (isServerMode) startPrefsSync();
    // The board is empty until the notes are in. Thus, the loading screen can
    // go then, not at this render. A failed load is also ready, because its
    // toast is what there is to see.
    void loadNotes().then(revealApp);
    const stopAutoNotes = initAutoNotes(() => notes.value);
    const stopBoardBackground = initBoardBackground();
    initReminderScheduler({
      notes: () => notes.value,
      subscribe: (listener) => effect(() => listener(notes.value)),
      updateNote: (id, changes) => {
        void updateNote(id, changes);
      },
    });
    void takeIncomingShare();
    welcomeIfNew();
    const stopLocaleReport = startAccountLocaleReport();
    return () => {
      stopLocaleReport();
      stopAutoNotes();
      stopBoardBackground();
    };
  }, []);
}
