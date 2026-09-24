import { effect } from "@preact/signals";
import { type MessageKey, plural, t } from "../i18n/index.js";
import { quotaRefusedAt } from "../storage/quota.js";
import { showError } from "./ui.js";

/**
 * How the note actions report what went wrong. An action reports its own
 * failure and resolves; it never rejects, and says whether it worked in its
 * return value: `false`, or `null` where a value was expected. Its call sites
 * are JSX handlers with nowhere to put a `catch`, so a rejection there would be
 * an unhandled rejection the user never sees.
 */

/**
 * One group of actions reported together, see {@link asBatch}. Passed down
 * explicitly rather than held in module state: two groups can be in flight at
 * once, and each has to count its own failures.
 */
export interface Batch {
  failures: number;
}

export function reportFailure(
  context: string,
  err: unknown,
  message: MessageKey,
  batch?: Batch,
): void {
  console.error(context, err);
  if (batch) {
    batch.failures++;
    return;
  }
  showError(t(message));
}

/**
 * Runs a group of actions as one operation. Each action given the batch counts
 * its failure there instead of raising its own toast, and one message names
 * the total at the end.
 */
export async function asBatch(
  run: (batch: Batch) => Promise<unknown>,
): Promise<boolean> {
  const batch: Batch = { failures: 0 };
  await run(batch);
  if (batch.failures === 0) return true;
  showError(plural("error.bulkFailed", batch.failures));
  return false;
}

/**
 * One user action can exhaust the quota several times over (`NoteCardEditor`
 * saves the note and a version), so the message is held back for a minute
 * after it is shown. Storage reports the refusal; the wording and the throttle
 * are here.
 */
const QUOTA_MESSAGE_QUIET_MS = 60 * 1000;
let lastQuotaMessageAt = 0;

effect(() => {
  const refusedAt = quotaRefusedAt.value;
  if (refusedAt === 0) return;
  if (refusedAt - lastQuotaMessageAt < QUOTA_MESSAGE_QUIET_MS) return;
  lastQuotaMessageAt = refusedAt;
  showError(t("storage.quotaExceeded"));
});
