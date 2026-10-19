import { plural } from "#/i18n/index.ts";
import { sealer } from "#/storage/sealing.ts";

/**
 * Says how many notes the server sent that did not open on this device, so
 * they are not on the board: one shared with this account whose key has not
 * arrived yet, or one whose key is damaged, and apart from those, one saved
 * by a newer version of the app, which a reload shows. Without it they would
 * be missing with nothing to say so.
 */
export function UnopenedNotes() {
  const unreadable = sealer.value?.unreadable.value.size ?? 0;
  const newer = sealer.value?.newer.value.size ?? 0;
  if (unreadable === 0 && newer === 0) return null;
  return (
    <div
      role="status"
      class="mt-4 w-full max-w-xl mx-auto space-y-1 rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/10"
    >
      {unreadable > 0 && <p>{plural("notes.unopened", unreadable)}</p>}
      {newer > 0 && <p>{plural("notes.newerFormat", newer)}</p>}
    </div>
  );
}
