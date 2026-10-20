import { signal } from "@preact/signals";

/**
 * What storage tells when the browser refuses a write because there is no
 * space, and nothing more. `actions.ts` decides what the user is told (which
 * message, in which language, how frequently). Thus, this layer has no
 * reference to the toast queue or the message catalogue.
 *
 * The code does not try the write again, and does not roll it back. The signal
 * in memory still carries the change. Thus, the session continues to work with
 * a note that is only in this tab.
 */

/** The `Date.now()` of the most recent refusal. 0 while there was none. */
export const quotaRefusedAt = signal(0);

export function reportQuotaRefusal(): void {
  quotaRefusedAt.value = Date.now();
}

/** A quota rejection, under the three names that browsers give it. */
export function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "QuotaExceededError" ||
      // Old WebKit and Firefox give a different name and a numeric code.
      err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      err.code === 22)
  );
}
