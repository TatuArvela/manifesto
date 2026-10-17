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
 * Starts what runs for as long as the board is up: the router, the socket,
 * the notes and what is worked out from them, and the first-visit checks.
 * Once, on mount; `loadEditor` is the board's to start, since it is a chunk
 * and not a service.
 */
export function useAppServices(): void {
  useEffect(() => {
    initRouter();
    startAppSocket();
    if (isServerMode) startPrefsSync();
    // The board is empty until the notes are in, so that, not this render,
    // is when the loading screen can go. A failed load is ready too: its
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
