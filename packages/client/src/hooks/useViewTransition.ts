import { effect } from "@preact/signals";
import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { animations } from "../state/prefs.js";
import { activeTag, activeView } from "../state/ui.js";

/** The view before is gone a little before the new one is all there, so the
 *  two never read as one muddled board. */
const VIEW_LEAVE_MS = 200;
const VIEW_ENTER_MS = 240;
/** A note on both boards travels from one place to the other. */
const NOTE_MOVE_MS = 320;
const NOTE_MOVE_EASING = "cubic-bezier(0.2, 0, 0, 1)";
/** How long the Tags view's sidebar takes to open or close. */
export const PANE_SLIDE_MS = 240;
const PANE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

/** What the transition follows from one board to the next: each note's card,
 *  and anything marked to slide in from the top edge (the new-note pad). */
const TRACKED = "[data-note-id], [data-view-slide]";

function keyOf(el: HTMLElement): string {
  return el.dataset.noteId ?? `slide:${el.dataset.viewSlide ?? ""}`;
}

/** The board as it was drawn just before the view changed. */
interface Before {
  ghost: HTMLElement;
  /** Where each tracked element was, in viewport coordinates. */
  places: Map<string, DOMRect>;
}

/**
 * Carries the board from one view to the next when the view or the tag
 * changes. A note on both boards moves from where it was to where it is now;
 * one only on the board before fades out where it stood, and one new to the
 * board fades in. Everything else (the composer, the search filters, a
 * section's heading) cross-fades.
 *
 * How the board before is kept to fade out, the new-note pad's slide, and
 * why `App` calls this after `usePaneSlide`, are in `.claude/rules/routing.md`.
 * The copy laid over the board is only a picture: inert, hidden from
 * assistive technology and without ids. Nothing plays on the first render,
 * which the splash covers.
 */
export function useViewTransition(
  boardRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
): void {
  const view = activeView.value;
  const tag = activeTag.value;
  const before = useRef<Before | null>(null);

  useEffect(() => {
    let first = true;
    const dispose = effect(() => {
      void activeView.value;
      void activeTag.value;
      if (first) {
        first = false;
        return;
      }
      before.current?.ghost.remove();
      before.current = null;
      const board = boardRef.current;
      const content = contentRef.current;
      if (!board || !content || !animations.peek()) return;
      const places = new Map<string, DOMRect>();
      for (const el of content.querySelectorAll<HTMLElement>(TRACKED)) {
        places.set(keyOf(el), el.getBoundingClientRect());
      }
      const ghost = ghostOf(board, content);
      before.current = { ghost, places };
      // The copy fades rather than its frame, so a pad lifted out of it into
      // the frame can slide away whole; the frame then goes with the pad.
      const done = () => {
        if (!ghost.dataset.sliding) ghost.remove();
      };
      void ghost.firstElementChild
        ?.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: VIEW_LEAVE_MS,
          easing: "ease-out",
          fill: "forwards",
        })
        .finished.then(done, done);
    });
    return () => {
      dispose();
      before.current?.ghost.remove();
    };
  }, [boardRef, contentRef]);

  const first = useRef(true);
  // Keyed on the view and tag, which the effect does not read: they are what it
  // plays on. A layout effect, so the first frame of each animation is the
  // first one drawn: after paint, the new view showed whole for a frame first.
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const board = boardRef.current;
    const content = contentRef.current;
    const was = before.current;
    if (!board || !content || !was || !animations.peek()) return;
    const boardTop = board.getBoundingClientRect().top + board.clientTop;
    const motions: Animation[] = [];
    const fadeIn = (el: Element) =>
      motions.push(
        el.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: VIEW_ENTER_MS,
          easing: "ease-in-out",
        }),
      );

    const staying = new Set<string>();
    for (const card of content.querySelectorAll<HTMLElement>(TRACKED)) {
      const key = keyOf(card);
      const from = was.places.get(key);
      const to = card.getBoundingClientRect();
      if (!from) {
        if (card.dataset.viewSlide === undefined) fadeIn(card);
        else {
          const above = `translateY(${boardTop - to.bottom}px)`;
          motions.push(
            card.animate([{ transform: above }, { transform: "none" }], {
              duration: NOTE_MOVE_MS,
              easing: NOTE_MOVE_EASING,
            }),
          );
        }
        continue;
      }
      staying.add(key);
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      // Out of sight at both ends, it has nothing to show on the way.
      if (offScreen(from) && offScreen(to)) continue;
      const move = card.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: NOTE_MOVE_MS, easing: NOTE_MOVE_EASING },
      );
      move.id = "view-move";
      motions.push(move);
    }
    for (const copy of was.ghost.querySelectorAll<HTMLElement>(TRACKED)) {
      const key = keyOf(copy);
      if (staying.has(key)) copy.style.visibility = "hidden";
      else if (copy.dataset.viewSlide !== undefined) {
        const from = was.places.get(key);
        if (from && from.height > 0) slideAway(was.ghost, copy, from, boardTop);
      }
    }
    fadeInAround(content, fadeIn);
    return () => {
      for (const motion of motions) motion.cancel();
    };
  }, [view, tag, boardRef, contentRef]);
}

/**
 * Lifts the copy of a pad leaving the board out of the fading copy into the
 * frame over it, where it is drawn, and slides it up under the board's top
 * edge. The frame is taken down once it is out of sight.
 */
function slideAway(
  ghost: HTMLElement,
  copy: HTMLElement,
  from: DOMRect,
  boardTop: number,
): void {
  const frame = ghost.getBoundingClientRect();
  const pad = copy.cloneNode(true) as HTMLElement;
  copy.style.visibility = "hidden";
  Object.assign(pad.style, {
    position: "absolute",
    left: `${from.left - frame.left}px`,
    top: `${from.top - frame.top}px`,
    width: `${from.width}px`,
    margin: "0",
  });
  ghost.appendChild(pad);
  ghost.dataset.sliding = "true";
  const gone = () => ghost.remove();
  void pad
    .animate(
      [
        { transform: "none" },
        { transform: `translateY(${boardTop - from.bottom}px)` },
      ],
      { duration: NOTE_MOVE_MS, easing: NOTE_MOVE_EASING, fill: "forwards" },
    )
    .finished.then(gone, gone);
}

/** Fades in everything under `el` that is not tracked and holds nothing that is. */
function fadeInAround(el: Element, fadeIn: (el: Element) => void): void {
  for (const child of el.children) {
    if (child.matches(TRACKED)) continue;
    if (child.querySelector(TRACKED)) fadeInAround(child, fadeIn);
    else fadeIn(child);
  }
}

function offScreen(box: DOMRect): boolean {
  return box.bottom < 0 || box.top > window.innerHeight;
}

/**
 * A copy of `content` as it is drawn now, laid over the visible part of
 * `board` (its scrollbar left uncovered) beside it in the shell.
 */
function ghostOf(board: HTMLElement, content: HTMLElement): HTMLElement {
  const boardBox = board.getBoundingClientRect();
  const contentBox = content.getBoundingClientRect();
  const parent = board.offsetParent ?? board.parentElement ?? document.body;
  const parentBox = parent.getBoundingClientRect();

  const frame = document.createElement("div");
  frame.setAttribute("aria-hidden", "true");
  frame.inert = true;
  Object.assign(frame.style, {
    position: "absolute",
    left: `${boardBox.left - parentBox.left + board.clientLeft}px`,
    top: `${boardBox.top - parentBox.top + board.clientTop}px`,
    width: `${board.clientWidth}px`,
    height: `${board.clientHeight}px`,
    overflow: "hidden",
    pointerEvents: "none",
  });

  const copy = content.cloneNode(true) as HTMLElement;
  copy.removeAttribute("id");
  for (const el of copy.querySelectorAll("[id]")) el.removeAttribute("id");
  Object.assign(copy.style, {
    position: "absolute",
    left: `${contentBox.left - boardBox.left - board.clientLeft}px`,
    top: `${contentBox.top - boardBox.top - board.clientTop}px`,
    width: `${contentBox.width}px`,
    margin: "0",
  });

  frame.appendChild(copy);
  parent.appendChild(frame);
  return frame;
}

/**
 * Opens and closes the Tags view's sidebar like a drawer: its width grows from
 * the rail or shrinks back into it, so the board beside it is carried along by
 * its edge rather than jumping to make room. The pane itself has to stay
 * mounted until it has closed, which the caller sees to (`usePresence` for
 * `PANE_SLIDE_MS`).
 *
 * The board's content is held at the width it ends at while the pane moves:
 * the masonry grid would otherwise reflow its columns on every frame. On
 * closing that is wider than the board until the end, so the board clips it
 * sideways rather than offering a horizontal scrollbar for the moment.
 */
export function usePaneSlide(
  paneRef: RefObject<HTMLElement | null>,
  boardRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  open: boolean,
): void {
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const pane = paneRef.current;
    const board = boardRef.current;
    const content = contentRef.current;
    if (!pane || !board || !content || !animations.peek()) return;
    const paneWidth = pane.getBoundingClientRect().width;
    const contentWidth = content.getBoundingClientRect().width;
    content.style.width = `${open ? contentWidth : contentWidth + paneWidth}px`;
    board.style.overflowX = "hidden";
    const width = ["0px", `${paneWidth}px`];
    const motion = pane.animate(
      { width: open ? width : width.reverse() },
      { duration: PANE_SLIDE_MS, easing: PANE_EASING, fill: "forwards" },
    );
    const release = () => {
      content.style.width = "";
      board.style.overflowX = "";
    };
    void motion.finished.then(release, release);
    return () => {
      motion.cancel();
      release();
    };
  }, [open, paneRef, boardRef, contentRef]);
}
