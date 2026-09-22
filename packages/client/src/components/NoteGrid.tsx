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
    return (
      <div class="flex flex-col items-center justify-center py-20 text-neutral-400 dark:text-neutral-600">
        {isSearch ? (
          <Search class="w-12 h-12 mb-4" />
        ) : (
          <StickyNote class="w-12 h-12 mb-4" />
        )}
        <p class="text-lg">
          {isSearch ? t("search.empty") : t("noteGrid.empty")}
        </p>
        <p class="text-sm">
          {isSearch ? t("search.emptyHint") : t("noteGrid.emptyHint")}
        </p>
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
