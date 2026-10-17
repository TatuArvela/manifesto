import type { Note } from "@manifesto/shared";
import { useMasonryGrid } from "../hooks/useMasonryGrid.js";
import { useReorderDrag } from "../hooks/useReorderDrag.js";
import { noteSize, viewMode } from "../state/prefs.js";
import { NoteCard } from "./card/NoteCard.js";
import { gridColumns } from "./gridColumns.js";

/**
 * One masonry section of note cards, reorderable by mouse drag and by touch.
 *
 * Drag state is per-section on purpose: the pinned and unpinned grids, and
 * each auto-note plugin's grid, are separate orderings and a card never
 * crosses between them. A drag from another section simply finds no source
 * here and is ignored.
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
   * One card-wide column whatever the view mode, for a section that is itself
   * one column of a wider grid (each auto-note plugin's in grid mode).
   */
  stacked?: boolean;
  /** `ids` is this section's order before the move. */
  onReorder: (ids: string[], fromIndex: number, toIndex: number) => void;
}) {
  const isList = viewMode.value === "list";
  const isColumn = isList || stacked;
  const isSquare = noteSize.value === "square";
  // By id: a note whose text changed is re-spanned by the grid's observer, and
  // the list is a new array on every auto-save of any note.
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
