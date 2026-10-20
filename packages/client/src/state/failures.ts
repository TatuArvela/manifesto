import { NewerNoteFormatError } from "@manifesto/shared";
import { effect } from "@preact/signals";
import { type MessageKey, plural, t } from "#/i18n/index.ts";
import { quotaRefusedAt } from "#/storage/quota.ts";
import { showError } from "./ui.ts";

/**
 * How the note actions report what went wrong. An action reports its own
 * failure and resolves. It never rejects, and its return value tells if it
 * worked: `false`, or `null` where a value was expected. Its call sites are JSX
 * handlers with no place to put a `catch`. Thus, a rejection there would be an
 * unhandled rejection that the user never sees.
 */

/**
 * One group of actions reported together. See {@link asBatch}. Given
 * explicitly, not kept in module state. Two groups can be in progress at the
 * same time, and each must count its own failures.
 */
export interface Batch {
  failures: number;
}

/**
 * Reports one failed action: in `batch` when given, or as a toast of `message`.
 * A failure because a newer version of the app saved the notes tells that,
 * because then a reload helps, not a retry.
 */
export function reportFailure(
  context: string,
  err: unknown,
  message: MessageKey,
  batch?: Batch,
): void {
  console.error("%s", context, err);
  if (batch) {
    batch.failures++;
    return;
  }
  showError(
    t(err instanceof NewerNoteFormatError ? "error.newerFormat" : message),
  );
}

/**
 * Runs a group of actions as one operation. Each action that gets the batch
 * counts its failure there, and does not show its own toast. One message names
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
 * One user action can go over the quota several times (`NoteCardEditor` saves
 * the note and a version). Thus, after the message shows, it does not show
 * again for one minute. Storage reports the refusal. The words and the throttle
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
