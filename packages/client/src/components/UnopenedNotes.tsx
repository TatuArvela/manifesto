import { plural } from "#/i18n/index.ts";
import { sealer } from "#/storage/sealing.ts";

/**
 * Tells how many notes from the server did not open on this device. Thus, they
 * are not on the board. One is a note shared with this account whose key did
 * not arrive yet, or whose key is damaged. Another is a note saved by a newer
 * version of the app, which a reload shows. Without this, they would be
 * missing, and nothing would tell it.
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
