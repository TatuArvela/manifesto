import { signal } from "@preact/signals";

/**
 * What storage says when the browser refuses a write for want of space, and
 * nothing more. Deciding what the user is told (which message, in which
 * language, how often) is `actions.ts`'s job, so this layer holds no
 * reference to the toast queue or the message catalogue.
 *
 * The write itself is not retried and not rolled back: the in-memory signal
 * still carries the change, so the session keeps working with a note that is
 * only in this tab.
 */

/** `Date.now()` of the most recent refusal; 0 while there has not been one. */
export const quotaRefusedAt = signal(0);

export function reportQuotaRefusal(): void {
  quotaRefusedAt.value = Date.now();
}

/** A quota rejection, under the three names browsers give it. */
export function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "QuotaExceededError" ||
      // Old WebKit / Firefox surface a different name and a numeric code.
      err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      err.code === 22)
  );
}
