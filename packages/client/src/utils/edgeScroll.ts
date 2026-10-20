/**
 * The scroll of a list while something is dragged along it. The browser does
 * this for a native drag. A drag controlled by the pointer (a checklist item, a
 * note under a finger) keeps the touch that would otherwise scroll. Thus, it
 * must scroll by itself, at the speed of the marquee selection.
 */

import { edgeScrollStep } from "./marquee.ts";

/** The box that scrolls `el`: the nearest ancestor that can, or the page. */
export function scrollParent(el: HTMLElement): HTMLElement {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    )
      return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.body;
}

/**
 * Scrolls `scroller` by one frame for a pointer at `y`. Its visible part is
 * what counts. Thus, an area taller than the window scrolls at the edges of the
 * window. True if it moved. Then the code must look up again the target of the
 * drag.
 */
export function edgeScroll(scroller: HTMLElement, y: number): boolean {
  const box =
    scroller === document.scrollingElement
      ? { top: 0, bottom: window.innerHeight }
      : scroller.getBoundingClientRect();
  const step = edgeScrollStep(
    y,
    Math.max(box.top, 0),
    Math.min(box.bottom, window.innerHeight),
  );
  if (step === 0) return false;
  const before = scroller.scrollTop;
  scroller.scrollTop = before + step;
  return scroller.scrollTop !== before;
}
