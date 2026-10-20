import { signal } from "@preact/signals";
import { confirmBeforeDelete } from "./prefs.ts";

export interface ConfirmRequest {
  title: string;
  /**
   * The consequence, in one line: where the note goes, or that it cannot come
   * back.
   */
  body?: string;
  confirmLabel: string;
  resolve: (confirmed: boolean) => void;
}

/** The question on the screen, or null when there is no question. */
export const confirmRequest = signal<ConfirmRequest | null>(null);

/**
 * Puts a question on the screen, and resolves to the answer of the reader.
 *
 * One at a time. A second question cancels the first, and does not go on top of
 * it. Thus, an answer can never go to a prompt that the reader does not look at
 * now, and the promise behind the replaced question always settles. A caller
 * that never gets an answer would leave the operation that it guarded half
 * complete.
 */
export function askConfirmation(
  request: Omit<ConfirmRequest, "resolve">,
): Promise<boolean> {
  return new Promise((resolve) => {
    confirmRequest.peek()?.resolve(false);
    confirmRequest.value = { ...request, resolve };
  });
}

/** Answers the question on the screen, and removes it. */
export function answerConfirmation(confirmed: boolean) {
  const pending = confirmRequest.peek();
  if (!pending) return;
  confirmRequest.value = null;
  pending.resolve(confirmed);
}

/**
 * The guard on the deletion of a single note. It asks only where the reader
 * asked for a question (Settings > Confirm Deletions). Bulk deletions call
 * `askConfirmation` directly. They take many notes at the same time, and need a
 * question whatever the preference says.
 */
export async function confirmDeletion(
  request: Omit<ConfirmRequest, "resolve">,
): Promise<boolean> {
  if (!confirmBeforeDelete.value) return true;
  return await askConfirmation(request);
}
