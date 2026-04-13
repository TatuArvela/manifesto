import { StickyNote } from "lucide-preact";
import { pinnedNotes, unpinnedNotes, viewMode } from "../state/index.js";
import { NoteCard } from "./NoteCard.js";

export function NoteGrid() {
  const pinned = pinnedNotes.value;
  const unpinned = unpinnedNotes.value;

  if (pinned.length === 0 && unpinned.length === 0) {
    return (
      <div class="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-600">
        <StickyNote class="w-12 h-12 mb-4" />
        <p class="text-lg">No notes yet</p>
        <p class="text-sm">Click "Take a note..." to get started</p>
      </div>
    );
  }

  const isList = viewMode.value === "list";
  const gridClass = isList
    ? "flex flex-col gap-3"
    : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-4";
  const wrapperClass = isList ? "max-w-xl mx-auto" : "";
  const headingClass =
    "text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2 px-1";

  return (
    <div class={`mt-4 ${wrapperClass}`}>
      {pinned.length > 0 && (
        <section>
          <h2 class={headingClass}>Pinned</h2>
          <div class={gridClass}>
            {pinned.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </div>
        </section>
      )}

      {pinned.length > 0 && unpinned.length > 0 && (
        <h2 class={`${headingClass} mt-6`}>Others</h2>
      )}

      {unpinned.length > 0 && (
        <section>
          <div class={gridClass}>
            {unpinned.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
