import { t } from "#/i18n/index.ts";
import { reorderNotes } from "#/state/actions.ts";
import { notesLoaded } from "#/state/notesStore.ts";
import { activeView, boardAnnouncement } from "#/state/ui.ts";
import {
  canReorder,
  notesHiddenByTag,
  pinnedNotes,
  unpinnedNotes,
} from "#/state/views.ts";
import { boardLabel } from "./boardCard.ts";
import { EmptyBoard } from "./EmptyBoard.tsx";
import { ReorderableGrid } from "./ReorderableGrid.tsx";

export function NoteGrid() {
  const pinned = pinnedNotes.value;
  const unpinned = unpinnedNotes.value;
  const reorderable = canReorder.value;

  if (pinned.length === 0 && unpinned.length === 0) {
    const isSearch = activeView.value === "search";
    if (!isSearch && !notesLoaded.value) return null;
    // An empty Notes view with notes kept out by a hidden tag is not "no
    // notes yet", and saying so would send someone looking for lost notes.
    const hiddenByTag =
      activeView.value === "active" ? notesHiddenByTag.value : 0;
    return <EmptyBoard view={activeView.value} hiddenByTag={hiddenByTag} />;
  }

  return (
    <div class="mt-4">
      <p class="sr-only" role="status">
        {boardAnnouncement.value}
      </p>
      {pinned.length > 0 && (
        <section>
          <h2 class="mb-2">
            <span class={boardLabel}>{t("noteGrid.pinned")}</span>
          </h2>
          <ReorderableGrid
            notes={pinned}
            reorderable={reorderable}
            onReorder={(ids, from, to) => void reorderNotes(ids, from, to)}
          />
        </section>
      )}

      {pinned.length > 0 && unpinned.length > 0 && (
        <h2 class="mt-6 mb-2">
          <span class={boardLabel}>{t("noteGrid.others")}</span>
        </h2>
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
