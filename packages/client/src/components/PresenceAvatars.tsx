import { presenceByNote } from "../state/presence.js";

function initials(name: string): string {
  const [first = "", ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1) ?? "";
  return (first.slice(0, 1) + last.slice(0, 1)).toUpperCase();
}

/**
 * Stack of small colored dots showing other users (or other tabs of the
 * same user) currently viewing the note. Pulled from the /api/ws presence
 * channel, so it shows users who are NOT the local connection.
 */
export function PresenceAvatars({ noteId }: { noteId: string }) {
  const viewers = presenceByNote.value.get(noteId);
  if (!viewers || viewers.size === 0) return null;
  const list = [...viewers.values()].slice(0, 4);
  return (
    <div class="flex items-center -space-x-1.5" aria-hidden="false">
      {list.map((user) => (
        <span
          key={user.id}
          title={user.displayName}
          class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold text-white border-2 border-white dark:border-neutral-800"
          style={{ backgroundColor: user.avatarColor || "#6366f1" }}
        >
          {initials(user.displayName)}
        </span>
      ))}
      {viewers.size > list.length && (
        <span class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold bg-neutral-300 dark:bg-neutral-600 text-neutral-700 dark:text-neutral-100 border-2 border-white dark:border-neutral-800">
          +{viewers.size - list.length}
        </span>
      )}
    </div>
  );
}
