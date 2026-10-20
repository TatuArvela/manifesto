import { WELCOME_ENABLED } from "#/config.ts";
import { hasStoredNotes } from "#/storage/LocalStorageAdapter.ts";
import { isServerMode } from "./account/auth.ts";
import { showWelcome } from "./ui.ts";

const WELCOMED_KEY = "manifesto:welcomed";

function seen(): boolean {
  try {
    return localStorage.getItem(WELCOMED_KEY) !== null;
  } catch {
    // Storage that cannot be read also cannot remember a dismissal, and a
    // welcome on each load would be worse than none.
    return true;
  }
}

/**
 * Opens the welcome dialog for a person who did not see it, one time for each
 * browser.
 *
 * An open-mode browser that already has notes belongs to a person who used the
 * app before the dialog existed. A welcome as a new user would be strange.
 * Thus, they count as welcomed. Connected mode has no local sign like that.
 * There, the dialog also tells on which server and account the notes are, which
 * is worth one look.
 */
export function welcomeIfNew(): void {
  if (!WELCOME_ENABLED || seen()) return;
  if (!isServerMode && hasStoredNotes()) {
    markWelcomed();
    return;
  }
  showWelcome.value = true;
}

export function markWelcomed(): void {
  try {
    localStorage.setItem(WELCOMED_KEY, new Date().toISOString());
  } catch {
    // No place to remember it. The dialog shows again next time.
  }
}
