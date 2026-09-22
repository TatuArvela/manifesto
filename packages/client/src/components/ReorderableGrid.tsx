import type { Note } from "@manifesto/shared";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useMasonryGrid } from "../hooks/useMasonryGrid.js";
import { animations, noteSize, viewMode } from "../state/index.js";
import { gridColumns } from "./gridColumns.js";
import { NoteCard } from "./NoteCard.js";

/** How far the pointer must travel after the order changes before it may change again. */
const REORDER_SETTLE_PX = 8;
/** How long the cards take to slide into a previewed order. */
const SHIFT_MS = 180;

/** The id of the card under a point, going by where each card is drawn. */
function cardIdAt(
  coords: { clientX: number; clientY: number },
  container: HTMLElement,
): string | null {
  for (const child of Array.from(container.children) as HTMLElement[]) {
    const rect = child.getBoundingClientRect();
    if (
      coords.clientX >= rect.left &&
      coords.clientX <= rect.right &&
      coords.clientY >= rect.top &&
      coords.clientY <= rect.bottom
    ) {
      return child.dataset.noteId ?? null;
    }
  }
  return null;
}

/** `ids` with `id` moved into the place `targetId` holds. */
export function moveInto(
  ids: readonly string[],
  id: string,
  targetId: string,
): string[] {
  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Where each card is drawn, by note id. */
function measureCards(container: HTMLElement): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>();
  for (const child of Array.from(container.children) as HTMLElement[]) {
    const id = child.dataset.noteId;
    if (id) rects.set(id, child.getBoundingClientRect());
  }
  return rects;
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

  // The order the cards are shown in while a drag is under way, or null for
  // the real one. Shown through each card's CSS `order`, not by moving the
  // DOM: a touch drag holds pointer capture on the card, and moving a node
  // out of the document to put it back elsewhere drops the capture.
  const [preview, setPreview] = useState<string[] | null>(null);
  const previewRef = useRef<string[] | null>(null);
  previewRef.current = preview;
  const dragSourceId = useRef<string | null>(null);
  const touchDragElRef = useRef<HTMLElement | null>(null);
  // Where the pointer was when the order last changed, and the card it swapped
  // places with. Cards move under the pointer when the order changes, and the
  // card just swapped with often slides to where the pointer is: taken for the
  // next target, it swapped straight back, and back again. It is passed over
  // until the pointer has left it, and nothing moves until the pointer has
  // travelled a little.
  const settledAt = useRef<{ clientX: number; clientY: number } | null>(null);
  const lastTargetId = useRef<string | null>(null);
  // Where the cards were drawn just before the order changed, for the slide.
  const shiftFrom = useRef<Map<string, DOMRect> | null>(null);
  // `dragover` and `pointermove` arrive faster than frames, and each lookup
  // measures every card, so the latest position waits for the next frame and
  // is looked up once there. A drop reads it at once instead.
  const pendingCoords = useRef<{ clientX: number; clientY: number } | null>(
    null,
  );
  const moveFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(moveFrame.current), []);

  const showOrder = (next: string[] | null) => {
    const container = gridRef.current;
    if (container && animations.peek())
      shiftFrom.current = measureCards(container);
    previewRef.current = next;
    setPreview(next);
  };

  // Puts the previewed order on the cards and slides them there from where
  // they were drawn: layout, so the first frame drawn is the slide's first.
  useLayoutEffect(() => {
    const container = gridRef.current;
    if (!container) return;
    const children = Array.from(container.children) as HTMLElement[];
    for (const child of children) {
      const index = preview ? preview.indexOf(child.dataset.noteId ?? "") : -1;
      child.style.order = index === -1 ? "" : String(index);
    }
    const from = shiftFrom.current;
    shiftFrom.current = null;
    if (!from) return;
    for (const child of children) {
      const before = from.get(child.dataset.noteId ?? "");
      if (!before) continue;
      // Measured mid-slide if one is running, which is where it is drawn;
      // that one then gives way to this.
      for (const running of child.getAnimations()) {
        if ((running as Animation).id === "reorder-shift") running.cancel();
      }
      const after = child.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      const shift = child.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: SHIFT_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
      shift.id = "reorder-shift";
    }
  }, [preview]);

  const beginDrag = (id: string) => {
    dragSourceId.current = id;
    settledAt.current = null;
    lastTargetId.current = null;
    document.body.classList.add("note-drag-active");
  };

  const cancelMove = () => {
    cancelAnimationFrame(moveFrame.current);
    moveFrame.current = 0;
    pendingCoords.current = null;
  };

  const endDrag = () => {
    cancelMove();
    document.body.classList.remove("note-drag-active");
    dragSourceId.current = null;
    settledAt.current = null;
    if (previewRef.current) showOrder(null);
  };

  /** Moves the dragged card into the place of the card under the pointer. */
  const moveTo = (coords: { clientX: number; clientY: number }) => {
    const container = gridRef.current;
    const sourceId = dragSourceId.current;
    if (!container || !sourceId) return;
    const last = settledAt.current;
    if (
      last &&
      Math.hypot(coords.clientX - last.clientX, coords.clientY - last.clientY) <
        REORDER_SETTLE_PX
    ) {
      return;
    }
    const targetId = cardIdAt(coords, container);
    if (targetId !== lastTargetId.current) lastTargetId.current = null;
    // Over the dragged card (already where it would go), a gap, or the card
    // it has just swapped with: no change.
    if (
      !targetId ||
      targetId === sourceId ||
      targetId === lastTargetId.current
    ) {
      return;
    }
    const current = previewRef.current ?? notes.map((n) => n.id);
    const next = moveInto(current, sourceId, targetId);
    settledAt.current = coords;
    lastTargetId.current = targetId;
    showOrder(next);
  };

  const scheduleMove = ({ clientX, clientY }: PointerEvent | DragEvent) => {
    pendingCoords.current = { clientX, clientY };
    if (moveFrame.current) return;
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = 0;
      const coords = pendingCoords.current;
      pendingCoords.current = null;
      // Through `latest`: this frame may run after a render this closure
      // predates.
      if (coords) latest.current.moveTo(coords);
    });
  };

  const commitDrop = () => {
    const sourceId = dragSourceId.current;
    const order = previewRef.current;
    if (!sourceId || !order) return;
    const ids = notes.map((n) => n.id);
    const fromIndex = ids.indexOf(sourceId);
    const toIndex = order.indexOf(sourceId);
    if (fromIndex === -1 || toIndex === -1) return;
    if (toIndex !== fromIndex) onReorder(ids, fromIndex, toIndex);
    // The real order now matches the preview, so dropping it moves nothing.
    shiftFrom.current = null;
    previewRef.current = null;
    setPreview(null);
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

  // A touch drag has no drag image of the browser's own, so the card under
  // the finger is a copy of ours, while the card itself holds its place in
  // the preview invisibly, as it does under a mouse.
  const ghostRef = useRef<{
    el: HTMLElement;
    startX: number;
    startY: number;
  } | null>(null);

  const removeGhost = () => {
    ghostRef.current?.el.remove();
    ghostRef.current = null;
  };
  useEffect(() => removeGhost, []);

  const handleTouchDragStart = (e: PointerEvent, id: string) => {
    if (!reorderable) return;
    const target = e.currentTarget as HTMLElement;
    touchDragElRef.current = target;
    const rect = target.getBoundingClientRect();
    const ghost = target.cloneNode(true) as HTMLElement;
    ghost.classList.remove("note-dragging");
    ghost.classList.add("note-drag-ghost");
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);
    removeGhost();
    ghostRef.current = { el: ghost, startX: e.clientX, startY: e.clientY };
    beginDrag(id);
    target.classList.add("note-dragging");
  };

  const handleTouchDragMove = (e: PointerEvent) => {
    if (!dragSourceId.current) return;
    const ghost = ghostRef.current;
    if (ghost) {
      ghost.el.style.translate = `${e.clientX - ghost.startX}px ${e.clientY - ghost.startY}px`;
    }
    scheduleMove(e);
  };

  const handleTouchDragEnd = (_e: PointerEvent, didDrag: boolean) => {
    cancelMove();
    removeGhost();
    if (touchDragElRef.current) {
      touchDragElRef.current.classList.remove("note-dragging");
      touchDragElRef.current = null;
    }
    if (didDrag) commitDrop();
    endDrag();
  };

  const handleDragOver = (e: DragEvent) => {
    if (!reorderable || !dragSourceId.current) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    scheduleMove(e);
  };

  // Entering a card is accepted as well as moving over one. The previewed
  // order moves cards under the pointer, so it often enters a new card just
  // before it is released, with no `dragover` in between, and a drop onto an
  // element whose `dragenter` went unanswered is refused: the drag ended as a
  // cancel and put everything back.
  const handleDragEnter = (e: DragEvent) => {
    if (!reorderable || !dragSourceId.current) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
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
    // Off the grid, a drop would change nothing, so the preview says so.
    cancelMove();
    settledAt.current = null;
    if (previewRef.current) showOrder(null);
  };

  // A drop commits the order on screen. A move still waiting for its frame
  // is dropped rather than applied: it would put the card somewhere the
  // preview never showed.
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    cancelMove();
    commitDrop();
  };

  // What the cards are handed never changes identity, and calls through to
  // this render's handlers: `NoteCard` is memoized, and a fresh closure per
  // card per render made every card re-render on every drop-gap change.
  const latest = useRef({
    moveTo,
    handleDragStart,
    handleDragEnd,
    handleTouchDragStart,
    handleTouchDragMove,
    handleTouchDragEnd,
  });
  latest.current = {
    moveTo,
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
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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
