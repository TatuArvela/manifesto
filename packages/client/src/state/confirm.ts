import { signal } from "@preact/signals";
import { confirmBeforeDelete } from "./prefs.js";

export interface ConfirmRequest {
  title: string;
  /** The consequence, in one line: where the note goes, or that it cannot come back. */
  body?: string;
  confirmLabel: string;
  resolve: (confirmed: boolean) => void;
}

/** The question on screen, or null when none is being asked. */
export const confirmRequest = signal<ConfirmRequest | null>(null);

/**
 * Puts a question on screen and resolves to what the reader answered.
 *
 * One at a time: a second question cancels the first rather than stacking, so
 * an answer can never land on a prompt the reader is no longer looking at, and
 * the promise behind the replaced one always settles. A caller that never
 * hears back would leave whatever it was guarding half-done.
 */
export function askConfirmation(
  request: Omit<ConfirmRequest, "resolve">,
): Promise<boolean> {
  return new Promise((resolve) => {
    confirmRequest.peek()?.resolve(false);
    confirmRequest.value = { ...request, resolve };
  });
}

/** Answers the question on screen and takes it down. */
export function answerConfirmation(confirmed: boolean) {
  const pending = confirmRequest.peek();
  if (!pending) return;
  confirmRequest.value = null;
  pending.resolve(confirmed);
}

/**
 * The guard on a single note's deletion, which asks only where the reader has
 * asked to be asked (Settings > Confirm Deletions). Bulk deletions call
 * `askConfirmation` directly instead: they take many notes at once and are
 * worth a question whatever the preference says.
 */
export async function confirmDeletion(
  request: Omit<ConfirmRequest, "resolve">,
): Promise<boolean> {
  if (!confirmBeforeDelete.value) return true;
  return await askConfirmation(request);
}
