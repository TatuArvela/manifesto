import { effect } from "@preact/signals";
import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { animations } from "#/state/prefs.ts";
import { activeTag, activeView } from "#/state/ui.ts";

/**
 * The old view is gone a little before the new view is fully there. Thus, the
 * two never look like one confused board.
 */
const VIEW_LEAVE_MS = 200;
const VIEW_ENTER_MS = 240;
/** A note on both boards moves from one position to the other. */
const NOTE_MOVE_MS = 320;
const NOTE_MOVE_EASING = "cubic-bezier(0.2, 0, 0, 1)";
/** How long the sidebar of the Tags view takes to open or close. */
export const PANE_SLIDE_MS = 240;
const PANE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

/**
 * What the transition follows from one board to the next: the card of each
 * note, and all elements marked to slide in from the top edge (the new-note
 * pad).
 */
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
 * Moves the board from one view to the next when the view or the tag changes. A
 * note on both boards moves from its old position to its new position. A note
 * that is only on the old board fades out where it was, and a note new on the
 * board fades in. All other content (the composer, the search filters, the
 * heading of a section) cross-fades.
 *
 * `.claude/rules/routing.md` tells how the old board stays to fade out, about
 * the slide of the new-note pad, and why `App` calls this after `usePaneSlide`.
 * The copy over the board is only a picture: inert, hidden from assistive
 * technology, and without ids. Nothing plays on the first render, which the
 * splash covers.
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
      // The copy fades, not its frame. Thus, a pad lifted out of it into the
      // frame can slide away fully. The frame then goes with the pad.
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
  // The key is the view and the tag, which the effect does not read. It plays
  // on them. A layout effect. Thus, the first frame of each animation is the
  // first drawn frame. After paint, the new view showed fully for one frame
  // first.
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
      // Out of sight at both ends. Thus, it has nothing to show on the way.
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
 * Lifts the copy of a pad that leaves the board out of the fading copy into the
 * frame over it, where it is drawn, and slides it up under the top edge of the
 * board. The frame goes after it is out of sight.
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

/** Fades in all under `el` that is not tracked and contains nothing that is. */
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
 * A copy of `content` as it is drawn now, over the visible part of `board` (its
 * scrollbar not covered), next to it in the shell.
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
 * Opens and closes the sidebar of the Tags view as a drawer. Its width grows
 * from the rail, or shrinks back into it. Thus, its edge carries the board next
 * to it, and the board does not jump to make space. The pane itself must stay
 * mounted until it closed. The caller does that (`usePresence` for
 * `PANE_SLIDE_MS`).
 *
 * The content of the board stays at its final width while the pane moves. The
 * masonry grid would otherwise change its columns in each frame. On close, that
 * is wider than the board until the end. Thus, the board clips it at the sides,
 * and does not show a horizontal scrollbar for that moment.
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
