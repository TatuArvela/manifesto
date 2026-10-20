import type { Note } from "@manifesto/shared";
import { useMasonryGrid } from "#/hooks/useMasonryGrid.ts";
import { useReorderDrag } from "#/hooks/useReorderDrag.ts";
import { noteSize, viewMode } from "#/state/prefs.ts";
import { NoteCard } from "./card/NoteCard.tsx";
import { gridColumns } from "./gridColumns.ts";

/**
 * One masonry section of note cards. You can reorder it with a mouse drag and
 * with touch.
 *
 * The drag state is for each section, on purpose. The pinned and unpinned
 * grids, and the grid of each auto-note plugin, are separate orders, and a card
 * never moves between them. A drag from a different section finds no source
 * here, and is ignored.
 */
export function ReorderableGrid({
  notes,
  reorderable,
  onReorder,
  stacked = false,
}: {
  notes: Note[];
  reorderable: boolean;
  /**
   * One column with the width of a card, whatever the view mode, for a section
   * that is itself one column of a wider grid (that of each auto-note plugin in
   * grid mode).
   */
  stacked?: boolean;
  /** `ids` is the order of this section before the move. */
  onReorder: (ids: string[], fromIndex: number, toIndex: number) => void;
}) {
  const isList = viewMode.value === "list";
  const isColumn = isList || stacked;
  const isSquare = noteSize.value === "square";
  // By id. The observer of the grid gives a note whose text changed a new span.
  // The list is a new array on each auto-save of any note.
  const gridRef = useMasonryGrid<HTMLDivElement>(
    notes.map((n) => n.id).join(" "),
    {
      enabled: !isColumn,
      square: isSquare,
    },
  );

  const { gridHandlers, cardHandlers } = useReorderDrag({
    notes,
    reorderable,
    onReorder,
    gridRef,
  });

  const layoutClass = isList
    ? "flex flex-col gap-3"
    : stacked
      ? "flex flex-col gap-4"
      : `grid ${gridColumns()} gap-x-4 items-start`;

  return (
    // biome-ignore lint/a11y/useSemanticElements: grid layout requires div
    <div
      ref={gridRef}
      role="list"
      class={layoutClass}
      style={isColumn ? undefined : { gridAutoRows: "1px" }}
      {...gridHandlers}
    >
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          draggable={reorderable}
          onDragStart={cardHandlers.onDragStart}
          onDragEnd={cardHandlers.onDragEnd}
          onTouchDragStart={cardHandlers.onTouchDragStart}
          onTouchDragMove={cardHandlers.onTouchDragMove}
          onTouchDragEnd={cardHandlers.onTouchDragEnd}
        />
      ))}
    </div>
  );
}
