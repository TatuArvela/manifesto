import { WELCOME_ENABLED } from "../config.js";
import { hasStoredNotes } from "../storage/LocalStorageAdapter.js";
import { isServerMode } from "./auth.js";
import { showWelcome } from "./ui.js";

const WELCOMED_KEY = "manifesto:welcomed";

function seen(): boolean {
  try {
    return localStorage.getItem(WELCOMED_KEY) !== null;
  } catch {
    // Storage that cannot be read cannot remember a dismissal either, and a
    // welcome on every load would be worse than none.
    return true;
  }
}

/**
 * Opens the welcome dialog for someone who has not seen it, once per browser.
 *
 * An open-mode browser that already holds notes belongs to someone who used
 * the app before the dialog existed; greeting them as new would be odd, so
 * they are counted as welcomed. Connected mode has no local trace like that,
 * and there the dialog also says which server and account the notes are on,
 * which is worth one look.
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
    // Nowhere to remember it; the dialog is shown again next time.
  }
}
