import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { exitSelectMode } from "#/state/selection.ts";
import { selectedNotes, selectMode } from "#/state/ui.ts";
import { sortedNotes } from "#/state/views.ts";
import {
  type Box,
  boxesIntersect,
  boxFromPoints,
  edgeScrollStep,
  marqueeSelection,
} from "#/utils/marquee.ts";
import { useEscapeStack } from "./useEscapeStack.ts";

/**
 * Where a press does something of its own. Thus, a drag that starts there is
 * not a selection. Cards are listed explicitly, because a card is also a native
 * drag source for the reorder. `[tabindex]` catches the custom controls that
 * are not buttons, for example the create-note stack.
 */
const IGNORE_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  "[contenteditable]",
  "[tabindex]",
  '[role="button"]',
  '[role="dialog"]',
  ".note-draggable-wrapper",
  // A view with no notes to select, where a drag must select text. The admin
  // view shows a temporary password that you must be able to copy.
  "[data-marquee-ignore]",
].join(",");

/** The movement before a press becomes a drag. Thus, a click stays a click. */
const THRESHOLD_PX = 4;

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * Drag-to-select on the note grid. Push on empty space inside `containerRef`
 * and drag. Each card that the box touches is selected, live, into the same
 * selection that the checkboxes of the cards build. Shift or Cmd/Ctrl adds to
 * the current selection, and does not replace it. Escape restores the selection
 * from before the drag. When you hold the pointer near the top or bottom edge,
 * the grid scrolls. Thus, the box can reach notes that are off the screen.
 *
 * A press on the same empty space without a drag clears the selection, as a
 * click next to the files in a file manager does, unless Shift or Cmd/Ctrl is
 * held.
 *
 * The box is only for the mouse. On touch, the same press is a scroll, and a
 * long press already selects. But a tap still clears.
 *
 * Returns the box to draw, in viewport coordinates and clipped to the
 * container, or null when no drag is in progress.
 */
export function useMarqueeSelection(
  containerRef: RefObject<HTMLElement | null>,
): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  useEscapeStack(box !== null, () => cancelRef.current?.());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onPointerDown = (down: PointerEvent) => {
      if (down.button !== 0) return;
      if (!(down.target instanceof Element)) return;
      if (down.target.closest(IGNORE_SELECTOR)) return;
      const origin = container.getBoundingClientRect();
      // A press on the scrollbar is a scroll.
      if (down.clientX - origin.left >= container.clientWidth) return;

      // Kept in the scrolled content coordinates of the container, not those of
      // the viewport. Thus, the corner where the drag started stays on the
      // notes under it while the container scrolls.
      const toContent = (clientX: number, clientY: number) => {
        const rect = container.getBoundingClientRect();
        return {
          x: clientX - rect.left + container.scrollLeft,
          y: clientY - rect.top + container.scrollTop,
        };
      };

      const additive = down.shiftKey || down.metaKey || down.ctrlKey;
      const baseSelection = selectedNotes.peek();
      const baseMode = selectMode.peek();
      const start = toContent(down.clientX, down.clientY);
      let pointer = { x: down.clientX, y: down.clientY };
      const canDraw = down.pointerType === "mouse";
      // Past the threshold: a drag, or on touch a scroll, and not a click.
      let moved = false;
      let active = false;
      let frame = 0;

      const update = () => {
        const rect = container.getBoundingClientRect();
        const content = boxFromPoints(start, toContent(pointer.x, pointer.y));
        const dx = rect.left - container.scrollLeft;
        const dy = rect.top - container.scrollTop;
        const viewport: Box = {
          left: content.left + dx,
          right: content.right + dx,
          top: content.top + dy,
          bottom: content.bottom + dy,
        };

        // The same notes as "select all" takes. Auto-notes are read-only, and
        // no bulk action applies to them.
        const selectable = new Set(
          sortedNotes
            .peek()
            .filter((n) => !n.readonly)
            .map((n) => n.id),
        );
        const hit: string[] = [];
        for (const el of container.querySelectorAll<HTMLElement>(
          "[data-note-id]",
        )) {
          const id = el.dataset.noteId;
          if (!id || !selectable.has(id)) continue;
          if (boxesIntersect(viewport, el.getBoundingClientRect()))
            hit.push(id);
        }

        const next = marqueeSelection(baseSelection, hit, additive);
        if (!sameSet(next, selectedNotes.peek())) selectedNotes.value = next;
        selectMode.value = next.size > 0 || (additive && baseMode);

        setBox({
          left: Math.max(viewport.left, rect.left),
          right: Math.min(viewport.right, rect.right),
          top: Math.max(viewport.top, rect.top),
          bottom: Math.min(viewport.bottom, rect.bottom),
        });
      };

      const tick = () => {
        frame = 0;
        if (!active) return;
        const rect = container.getBoundingClientRect();
        const before = container.scrollTop;
        container.scrollTop += edgeScrollStep(pointer.y, rect.top, rect.bottom);
        update();
        // Continue to scroll while the pointer is held at the edge and there is
        // more to go. A pointer that stops sends no events.
        if (container.scrollTop !== before) {
          frame = requestAnimationFrame(tick);
        }
      };

      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== down.pointerId) return;
        pointer = { x: move.clientX, y: move.clientY };
        if (!active) {
          const distance = Math.hypot(
            move.clientX - down.clientX,
            move.clientY - down.clientY,
          );
          if (distance < THRESHOLD_PX) return;
          moved = true;
          if (!canDraw) return;
          active = true;
          // If not, the drag also paints a text selection across the page.
          document.getSelection()?.removeAllRanges();
          document.body.classList.add("marquee-active");
        }
        move.preventDefault();
        if (!frame) frame = requestAnimationFrame(tick);
      };

      const finish = (commit: boolean) => {
        document.removeEventListener("pointermove", onMove, true);
        document.removeEventListener("pointerup", onUp, true);
        document.removeEventListener("pointercancel", onCancel, true);
        cancelAnimationFrame(frame);
        frame = 0;
        cancelRef.current = null;
        if (!active) {
          if (commit && !moved && !additive && selectMode.peek()) {
            exitSelectMode();
          }
          return;
        }
        active = false;
        document.body.classList.remove("marquee-active");
        if (!commit) {
          selectedNotes.value = baseSelection;
          selectMode.value = baseMode;
        }
        setBox(null);
      };

      const onUp = (up: PointerEvent) => {
        if (up.pointerId === down.pointerId) finish(true);
      };
      const onCancel = (cancel: PointerEvent) => {
        if (cancel.pointerId === down.pointerId) finish(false);
      };

      cancelRef.current = () => finish(false);
      document.addEventListener("pointermove", onMove, true);
      document.addEventListener("pointerup", onUp, true);
      document.addEventListener("pointercancel", onCancel, true);
    };

    container.addEventListener("pointerdown", onPointerDown);
    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      cancelRef.current?.();
    };
  }, [containerRef]);

  return box;
}
