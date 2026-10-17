import { plural } from "#/i18n/index.js";
import { sealer } from "#/storage/sealing.js";

/**
 * Says how many notes the server sent that did not open on this device, so
 * they are not on the board: one shared with this account whose key has not
 * arrived yet, or one whose key is damaged. Without it they would be missing
 * with nothing to say so.
 */
export function UnopenedNotes() {
  const count = sealer.value?.unreadable.value.size ?? 0;
  if (count === 0) return null;
  return (
    <p
      role="status"
      class="mt-4 w-full max-w-xl mx-auto rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/10"
    >
      {plural("notes.unopened", count)}
    </p>
  );
}
