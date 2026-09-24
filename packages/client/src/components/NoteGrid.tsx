import { Search, StickyNote } from "lucide-preact";
import { t } from "../i18n/index.js";
import {
  activeView,
  canReorder,
  notesLoaded,
  pinnedNotes,
  reorderNotes,
  unpinnedNotes,
} from "../state/index.js";
import { ReorderableGrid } from "./ReorderableGrid.js";

export function NoteGrid() {
  const pinned = pinnedNotes.value;
  const unpinned = unpinnedNotes.value;
  const reorderable = canReorder.value;

  if (pinned.length === 0 && unpinned.length === 0) {
    const isSearch = activeView.value === "search";
    if (!isSearch && !notesLoaded.value) return null;
    // On a card of its own, so it stays legible over a board picture or a
    // busy texture, and not selectable: it is a message, not content.
    return (
      <div class="flex justify-center py-16">
        <div class="flex flex-col items-center text-center select-none rounded-2xl px-10 py-8 bg-white/85 dark:bg-neutral-800/85 backdrop-blur-sm border border-neutral-200 dark:border-neutral-700 shadow-sm text-neutral-500 dark:text-neutral-400">
          {isSearch ? (
            <Search class="w-12 h-12 mb-4" />
          ) : (
            <StickyNote class="w-12 h-12 mb-4" />
          )}
          <p class="text-lg text-neutral-700 dark:text-neutral-200">
            {isSearch ? t("search.empty") : t("noteGrid.empty")}
          </p>
          <p class="text-sm">
            {isSearch ? t("search.emptyHint") : t("noteGrid.emptyHint")}
          </p>
        </div>
      </div>
    );
  }

  const headingClass =
    "text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400 mb-2 px-1";

  return (
    <div class="mt-4">
      {pinned.length > 0 && (
        <section>
          <h2 class={headingClass}>{t("noteGrid.pinned")}</h2>
          <ReorderableGrid
            notes={pinned}
            reorderable={reorderable}
            onReorder={(ids, from, to) => void reorderNotes(ids, from, to)}
          />
        </section>
      )}

      {pinned.length > 0 && unpinned.length > 0 && (
        <h2 class={`${headingClass} mt-6`}>{t("noteGrid.others")}</h2>
      )}

      {unpinned.length > 0 && (
        <section>
          <ReorderableGrid
            notes={unpinned}
            reorderable={reorderable}
            onReorder={(ids, from, to) => void reorderNotes(ids, from, to)}
          />
        </section>
      )}
    </div>
  );
}
