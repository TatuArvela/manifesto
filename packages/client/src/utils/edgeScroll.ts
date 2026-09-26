/**
 * Scrolling a list while something is dragged along it. The browser does this
 * for a native drag; a pointer-driven one (a checklist item, a note under a
 * finger) holds the touch that would otherwise scroll, so it has to scroll
 * for itself, at the pace the marquee selection scrolls at.
 */

import { edgeScrollStep } from "./marquee.js";

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
 * Scrolls `scroller` one frame's worth for a pointer at `y`. The visible part
 * of it is what counts, so an area taller than the window scrolls at the
 * window's edges. True if it moved, which is when whatever the drag is aiming
 * at has to be looked up again.
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
