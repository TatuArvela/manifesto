import type { Note } from "@manifesto/shared";
import { useEffect, useRef, useState } from "preact/hooks";
import { useMasonryGrid } from "../hooks/useMasonryGrid.js";
import { noteSize, viewMode } from "../state/index.js";
import { GRID_COLUMNS } from "./gridColumns.js";
import { NoteCard } from "./NoteCard.js";

/**
 * Whether the container lays its children out in a single column, measured
 * rather than inferred from the view mode, because the masonry grid collapses to one
 * column at narrow widths too, and there the drop indicator has to be a
 * horizontal rule between cards rather than a vertical one beside them.
 *
 * Exported so the three layouts it has to tell apart can be tested against a
 * real computed style.
 */
export function isContainerVertical(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  if (style.display.startsWith("flex")) return true;
  const cols = style.gridTemplateColumns.trim();
  if (!cols || cols === "none") return true;
  return cols.split(/\s+/).length === 1;
}

/** The gap the drop rule has to sit in the middle of. */
function measureVerticalGap(el: HTMLElement): number {
  const children = Array.from(el.children) as HTMLElement[];
  if (children.length < 2) return 16;
  const first = children[0].getBoundingClientRect();
  const second = children[1].getBoundingClientRect();
  return Math.max(0, second.top - first.bottom);
}

/** The index a card dropped at these coordinates would be inserted at. */
function findNearestGap(
  coords: { clientX: number; clientY: number },
  container: HTMLElement,
  vertical: boolean,
): number {
  const children = Array.from(container.children) as HTMLElement[];
  if (children.length === 0) return 0;

  if (vertical) {
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      if (coords.clientY < rect.top + rect.height / 2) return i;
    }
    return children.length;
  }

  let nearestIdx = 0;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < children.length; i++) {
    const rect = children[i].getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(coords.clientX - cx, coords.clientY - cy);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIdx = i;
    }
  }

  // Before or after the nearest card, by which half of it the pointer is over.
  const rect = children[nearestIdx].getBoundingClientRect();
  return coords.clientX < rect.left + rect.width / 2
    ? nearestIdx
    : nearestIdx + 1;
}

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
}: {
  notes: Note[];
  reorderable: boolean;
  /** `ids` is this section's order before the move. */
  onReorder: (ids: string[], fromIndex: number, toIndex: number) => void;
}) {
  const isList = viewMode.value === "list";
  const isSquare = noteSize.value === "square";
  // By id: a note whose text changed is re-spanned by the grid's observer, and
  // the list is a new array on every auto-save of any note.
  const gridRef = useMasonryGrid<HTMLDivElement>(
    notes.map((n) => n.id).join(" "),
    {
      enabled: !isList,
      square: isSquare,
    },
  );

  const [dropGap, setDropGap] = useState<number | null>(null);
  const [dragVertical, setDragVertical] = useState(false);
  const dragSourceId = useRef<string | null>(null);
  const touchDragElRef = useRef<HTMLElement | null>(null);
  // `dragover` and `pointermove` arrive faster than frames, and each drop-gap
  // lookup measures every card, so the latest position waits for the next
  // frame and is looked up once there. A drop reads it at once instead.
  const pendingCoords = useRef<{ clientX: number; clientY: number } | null>(
    null,
  );
  const gapFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(gapFrame.current), []);

  const beginDrag = (id: string) => {
    dragSourceId.current = id;
    const container = gridRef.current;
    if (container) {
      setDragVertical(isContainerVertical(container));
      container.style.setProperty(
        "--drop-gap",
        `${measureVerticalGap(container)}px`,
      );
    }
    document.body.classList.add("note-drag-active");
  };

  const cancelGap = () => {
    cancelAnimationFrame(gapFrame.current);
    gapFrame.current = 0;
    pendingCoords.current = null;
  };

  const endDrag = () => {
    cancelGap();
    document.body.classList.remove("note-drag-active");
    dragSourceId.current = null;
    setDragVertical(false);
    setDropGap(null);
  };

  /** Where a pointer at these coordinates would drop, or null for a no-op. */
  const gapAt = (coords: { clientX: number; clientY: number }) => {
    const container = gridRef.current;
    if (!container) return null;
    const gap = findNearestGap(coords, container, dragVertical);
    const srcIdx = notes.findIndex((n) => n.id === dragSourceId.current);
    // Either side of the card being dragged is where it already is.
    if (srcIdx !== -1 && (gap === srcIdx || gap === srcIdx + 1)) return null;
    return gap;
  };

  const scheduleGap = ({ clientX, clientY }: PointerEvent | DragEvent) => {
    pendingCoords.current = { clientX, clientY };
    if (gapFrame.current) return;
    gapFrame.current = requestAnimationFrame(() => {
      gapFrame.current = 0;
      const coords = pendingCoords.current;
      pendingCoords.current = null;
      // Through `latest`: this frame may run after a render this closure
      // predates, one that changed the drag's axis.
      if (coords) setDropGap(latest.current.gapAt(coords));
    });
  };

  /** The gap as of the last event, including one still waiting for a frame. */
  const settledGap = () => {
    const coords = pendingCoords.current;
    cancelGap();
    return coords ? gapAt(coords) : dropGap;
  };

  const commitDrop = (gap: number | null) => {
    const sourceId = dragSourceId.current;
    if (!sourceId || gap === null) return;
    const ids = notes.map((n) => n.id);
    const fromIndex = ids.indexOf(sourceId);
    if (fromIndex === -1) return;
    // Removing the card first shifts every later gap down by one.
    const toIndex = gap > fromIndex ? gap - 1 : gap;
    if (toIndex !== fromIndex) onReorder(ids, fromIndex, toIndex);
  };

  const handleDragStart = (e: DragEvent, id: string) => {
    if (!reorderable) return;
    const target = e.currentTarget as HTMLElement;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      const rect = target.getBoundingClientRect();
      // An off-screen clone, so the ghost is the whole card rather than the
      // part of it currently on screen (Safari/iOS behaviour).
      const clone = target.cloneNode(true) as HTMLElement;
      clone.style.position = "fixed";
      clone.style.top = "-10000px";
      clone.style.left = "-10000px";
      clone.style.width = `${rect.width}px`;
      clone.style.height = `${rect.height}px`;
      clone.style.pointerEvents = "none";
      clone.classList.remove("note-dragging");
      document.body.appendChild(clone);
      e.dataTransfer.setDragImage(
        clone,
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
      setTimeout(() => clone.remove(), 0);
    }
    beginDrag(id);
    requestAnimationFrame(() => target.classList.add("note-dragging"));
  };

  const handleDragEnd = (e: DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove("note-dragging");
    endDrag();
  };

  const handleTouchDragStart = (e: PointerEvent, id: string) => {
    if (!reorderable) return;
    const target = e.currentTarget as HTMLElement;
    touchDragElRef.current = target;
    beginDrag(id);
    target.classList.add("note-dragging");
  };

  const handleTouchDragMove = (e: PointerEvent) => {
    if (!dragSourceId.current) return;
    scheduleGap(e);
  };

  const handleTouchDragEnd = (_e: PointerEvent, didDrag: boolean) => {
    const gap = settledGap();
    if (touchDragElRef.current) {
      touchDragElRef.current.classList.remove("note-dragging");
      touchDragElRef.current = null;
    }
    if (didDrag) commitDrop(gap);
    endDrag();
  };

  const handleDragOver = (e: DragEvent) => {
    if (!reorderable || !dragSourceId.current) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    scheduleGap(e);
  };

  const handleDragLeave = (e: DragEvent) => {
    const container = gridRef.current;
    // Moving between two cards leaves the card, not the grid.
    if (
      container &&
      e.relatedTarget instanceof Node &&
      container.contains(e.relatedTarget)
    ) {
      return;
    }
    cancelGap();
    setDropGap(null);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    commitDrop(settledGap());
    setDropGap(null);
  };

  const dropSideOf = (idx: number) => {
    if (dropGap === null) return undefined;
    if (dropGap === notes.length && idx === notes.length - 1) return "after";
    if (dropGap === idx) return "before";
    return undefined;
  };

  // What the cards are handed never changes identity, and calls through to
  // this render's handlers: `NoteCard` is memoized, and a fresh closure per
  // card per render made every card re-render on every drop-gap change.
  const latest = useRef({
    gapAt,
    handleDragStart,
    handleDragEnd,
    handleTouchDragStart,
    handleTouchDragMove,
    handleTouchDragEnd,
  });
  latest.current = {
    gapAt,
    handleDragStart,
    handleDragEnd,
    handleTouchDragStart,
    handleTouchDragMove,
    handleTouchDragEnd,
  };
  const [cardHandlers] = useState(() => ({
    onDragStart: (e: DragEvent, id: string) =>
      latest.current.handleDragStart(e, id),
    onDragEnd: (e: DragEvent) => latest.current.handleDragEnd(e),
    onTouchDragStart: (e: PointerEvent, id: string) =>
      latest.current.handleTouchDragStart(e, id),
    onTouchDragMove: (e: PointerEvent) => latest.current.handleTouchDragMove(e),
    onTouchDragEnd: (e: PointerEvent, didDrag: boolean) =>
      latest.current.handleTouchDragEnd(e, didDrag),
  }));

  // A single-column layout puts the drop rule between cards rather than beside
  // one, which is a different set of `::after` rules, and the list view is
  // always single-column.
  const layoutClass = isList
    ? "flex flex-col gap-3"
    : `grid ${GRID_COLUMNS} gap-x-4 items-start`;

  return (
    // biome-ignore lint/a11y/useSemanticElements: grid layout requires div
    <div
      ref={gridRef}
      role="list"
      class={`${layoutClass}${dragVertical ? " note-grid-vertical" : ""}`}
      style={isList ? undefined : { gridAutoRows: "1px" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {notes.map((note, idx) => (
        <NoteCard
          key={note.id}
          note={note}
          draggable={reorderable}
          onDragStart={cardHandlers.onDragStart}
          onDragEnd={cardHandlers.onDragEnd}
          onTouchDragStart={cardHandlers.onTouchDragStart}
          onTouchDragMove={cardHandlers.onTouchDragMove}
          onTouchDragEnd={cardHandlers.onTouchDragEnd}
          dropSide={dropSideOf(idx)}
        />
      ))}
    </div>
  );
}
