import type { Note } from "@manifesto/shared";
import type { RefObject } from "preact";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import { animations } from "#/state/prefs.ts";
import { edgeScroll, scrollParent } from "#/utils/edgeScroll.ts";

/**
 * How far the pointer must move after the order changes before it can change
 * again.
 */
const REORDER_SETTLE_PX = 8;
/** How long the cards take to slide into a previewed order. */
const SHIFT_MS = 180;

/** The id of the card under a point, from where each card is drawn. */
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

/** `ids`, with `id` moved into the position of `targetId`. */
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

/** What the grid and each card get, to take part in a drag. */
export interface ReorderDrag {
  gridHandlers: {
    onDragEnter: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
  /**
   * The same functions on each render. Thus, a memoized card stays where it is.
   */
  cardHandlers: {
    onDragStart: (e: DragEvent, id: string) => void;
    onDragEnd: (e: DragEvent) => void;
    onTouchDragStart: (e: PointerEvent, id: string) => void;
    onTouchDragMove: (e: PointerEvent) => void;
    onTouchDragEnd: (e: PointerEvent, didDrag: boolean) => void;
  };
}

/**
 * A drag of the cards of one section into a new order, with a mouse and with
 * touch. The order shows as a preview during the drag, and goes to `onReorder`
 * on the drop. See `ReorderableGrid`.
 */
export function useReorderDrag({
  notes,
  reorderable,
  onReorder,
  gridRef,
}: {
  notes: Note[];
  reorderable: boolean;
  /** `ids` is the order of this section before the move. */
  onReorder: (ids: string[], fromIndex: number, toIndex: number) => void;
  gridRef: RefObject<HTMLDivElement | null>;
}): ReorderDrag {
  // The order in which the cards show during a drag, or null for the real
  // order. The CSS `order` of each card shows it. The code does not move the
  // DOM. A touch drag keeps pointer capture on the card, and when a node moves
  // out of the document and back to a different place, the capture is lost.
  const [preview, setPreview] = useState<string[] | null>(null);
  const previewRef = useRef<string[] | null>(null);
  previewRef.current = preview;
  const dragSourceId = useRef<string | null>(null);
  const touchDragElRef = useRef<HTMLElement | null>(null);
  // Where the pointer was when the order last changed, and the card with which
  // it swapped. Cards move under the pointer when the order changes, and the
  // card that just swapped frequently slides to where the pointer is. When the
  // code took it as the next target, it swapped back immediately, and back
  // again. Thus, the code ignores it until the pointer leaves it, and nothing
  // moves until the pointer moved a little.
  const settledAt = useRef<{ clientX: number; clientY: number } | null>(null);
  const lastTargetId = useRef<string | null>(null);
  // Where the cards were drawn just before the order changed, for the slide.
  const shiftFrom = useRef<Map<string, DOMRect> | null>(null);
  // `dragover` and `pointermove` arrive faster than frames, and each lookup
  // measures each card. Thus, the latest position waits for the next frame, and
  // the code looks it up one time there. A drop reads it immediately.
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

  // Puts the previewed order on the cards, and slides them there from where
  // they were drawn. Layout. Thus, the first drawn frame is the first frame of
  // the slide.
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
      // Measured during a slide if one runs, because it is drawn there. That
      // slide then stops for this one.
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
  }, [gridRef, preview]);

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

  /** Moves the dragged card into the position of the card under the pointer. */
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
    // with which it just swapped: no change.
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
      // Through `latest`. This frame can run after a render that is newer than
      // this closure.
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
    // The real order now agrees with the preview. Thus, a drop moves nothing.
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
      // A clone off the screen. Thus, the ghost is the full card, not only the
      // part of it that is on the screen now (the behavior of Safari/iOS).
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

  // A touch drag has no drag image from the browser. Thus, the card under the
  // finger is our own copy, while the card itself invisibly keeps its position
  // in the preview, as under a mouse.
  const ghostRef = useRef<{
    el: HTMLElement;
    startX: number;
    startY: number;
  } | null>(null);

  // A finger that holds a card cannot also scroll the board. Thus, the board
  // scrolls itself while the finger stays near its top or bottom edge. The card
  // under a finger that does not move changes when the board moves. Thus, each
  // frame that scrolls looks for it again.
  const touchScroll = useRef<{
    scroller: HTMLElement;
    frame: number;
    coords: { clientX: number; clientY: number };
  } | null>(null);

  const scrollFrame = () => {
    const scroll = touchScroll.current;
    if (!scroll) return;
    scroll.frame = requestAnimationFrame(scrollFrame);
    if (edgeScroll(scroll.scroller, scroll.coords.clientY)) {
      settledAt.current = null;
      latest.current.moveTo(scroll.coords);
    }
  };

  const stopTouchScroll = useCallback(() => {
    if (touchScroll.current) cancelAnimationFrame(touchScroll.current.frame);
    touchScroll.current = null;
  }, []);

  const removeGhost = useCallback(() => {
    ghostRef.current?.el.remove();
    ghostRef.current = null;
  }, []);
  useEffect(
    () => () => {
      removeGhost();
      stopTouchScroll();
    },
    [removeGhost, stopTouchScroll],
  );

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
    stopTouchScroll();
    touchScroll.current = {
      scroller: scrollParent(target),
      frame: requestAnimationFrame(scrollFrame),
      coords: { clientX: e.clientX, clientY: e.clientY },
    };
  };

  const handleTouchDragMove = (e: PointerEvent) => {
    if (!dragSourceId.current) return;
    const ghost = ghostRef.current;
    if (ghost) {
      ghost.el.style.translate = `${e.clientX - ghost.startX}px ${e.clientY - ghost.startY}px`;
    }
    if (touchScroll.current)
      touchScroll.current.coords = { clientX: e.clientX, clientY: e.clientY };
    scheduleMove(e);
  };

  const handleTouchDragEnd = (_e: PointerEvent, didDrag: boolean) => {
    stopTouchScroll();
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

  // The code accepts an entry into a card, and also a move over one. The
  // previewed order moves cards under the pointer. Thus, it frequently enters a
  // new card just before the release, with no `dragover` between. The browser
  // refuses a drop onto an element whose `dragenter` got no answer. Then the
  // drag ended as a cancel, and all cards went back.
  const handleDragEnter = (e: DragEvent) => {
    if (!reorderable || !dragSourceId.current) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  };

  const handleDragLeave = (e: DragEvent) => {
    const container = gridRef.current;
    // A move between two cards leaves the card, not the grid.
    if (
      container &&
      e.relatedTarget instanceof Node &&
      container.contains(e.relatedTarget)
    ) {
      return;
    }
    // Off the grid, a drop would change nothing. Thus, the preview shows that.
    cancelMove();
    settledAt.current = null;
    if (previewRef.current) showOrder(null);
  };

  // A drop commits the order on the screen. The code drops a move that still
  // waits for its frame, and does not apply it. It would put the card in a
  // position that the preview never showed.
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    cancelMove();
    commitDrop();
  };

  // What the cards get never changes identity, and calls the handlers of this
  // render. `NoteCard` is memoized. A new closure for each card on each render
  // made each card render again on each change of the drop gap.
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

  return {
    gridHandlers: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
    cardHandlers,
  };
}
