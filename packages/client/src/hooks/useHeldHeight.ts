import type { RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

interface Watch {
  /** Keeps the last height of each element while nothing holds it. */
  sizes: ResizeObserver;
  /** Holds an element when a child of it goes. */
  removals: MutationObserver;
  last: WeakMap<HTMLElement, number>;
  watched: Set<HTMLElement>;
}

/**
 * Keeps the heights of `refs` while the editor of a note is built again (solo
 * to collab), until a different `editor` arrives.
 *
 * The editor is built again when the shared document of a note on a server
 * arrives, and its area was empty between the two builds. The panel of the
 * note became short and then tall again, and the grow of an open followed it.
 *
 * The removal of the old content itself starts the hold. A `MutationObserver`
 * reports it in a microtask, after the change and before the paint, and the
 * element then gets the last height that a `ResizeObserver` recorded while
 * the content was there. A hold that waited for the state of the editor came
 * one render late, and a hold from the teardown of the old editor came after
 * Preact had removed its content: both let a collapsed frame be painted.
 *
 * The release is a layout effect on the identity of the editor, not on its
 * presence: when the state goes to null and to the new editor in one render,
 * only the identity changes. The elements that a wrapper holds (the text, the
 * place of the formatting bar) never lose their own children otherwise.
 *
 * An inert copy of the old content also stays in its place (`keepCopies`).
 */
export function useHeldHeight(
  refs: RefObject<HTMLElement | null>[],
  editor: unknown,
): void {
  const watchRef = useRef<Watch | null>(null);
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useLayoutEffect(() => {
    const last = new WeakMap<HTMLElement, number>();
    const watch: Watch = {
      last,
      watched: new Set(),
      sizes: new ResizeObserver((entries) => {
        for (const { target } of entries) {
          if (target instanceof HTMLElement && !target.style.minHeight) {
            last.set(target, target.offsetHeight);
          }
        }
      }),
      removals: new MutationObserver((records) => {
        // By element first: one removal can come as several records (the
        // hidden raw textarea, then the editor), and only the first one would
        // have found the element not held yet.
        const removals = new Map<HTMLElement, Node[]>();
        for (const { target, removedNodes } of records) {
          if (!(target instanceof HTMLElement)) continue;
          const removed = [...removedNodes].filter(
            (node) => !(node instanceof HTMLElement && isCopy(node)),
          );
          if (removed.length === 0) continue;
          removals.set(target, [...(removals.get(target) ?? []), ...removed]);
        }
        for (const [target, removed] of removals) {
          const height = last.get(target) ?? 0;
          if (height > 0 && !target.style.minHeight) {
            target.style.minHeight = `${height}px`;
            keepCopies(target, removed);
          }
        }
      }),
    };
    watchRef.current = watch;
    return () => {
      watch.sizes.disconnect();
      watch.removals.disconnect();
      watchRef.current = null;
    };
  }, []);

  // Each render, because an element can mount later (the place of the bar
  // follows a setting). The first height comes from the first report of the
  // `ResizeObserver`, after the next layout. A read of `offsetHeight` here made
  // the browser lay out the full sheet in the task of the click, before the
  // editor was there (5 ms), and again after it.
  useLayoutEffect(() => {
    const watch = watchRef.current;
    if (!watch) return;
    for (const ref of refs) {
      const el = ref.current;
      if (!el || watch.watched.has(el)) continue;
      watch.watched.add(el);
      watch.sizes.observe(el);
      watch.removals.observe(el, { childList: true });
    }
  });

  // Only on a new editor.
  useLayoutEffect(() => {
    if (!editor) return;
    for (const ref of refsRef.current) {
      const el = ref.current;
      if (el) release(el);
    }
  }, [editor]);
}

const COPY = "heldCopy";
const RELATIVE = "heldRelative";

function isCopy(el: HTMLElement): boolean {
  return el.dataset[COPY] !== undefined;
}

/**
 * Leaves an inert copy of the content that just went in its place, until the
 * new editor is there. With only the height kept, the text was empty for the
 * frames that the new editor took to build: a blink in the middle of the open.
 * When the observer reports, the removed content still has its text, because
 * the old editor is destroyed only after that.
 */
function keepCopies(target: HTMLElement, removed: Node[]) {
  const copies: HTMLElement[] = [];
  for (const node of removed) {
    if (!(node instanceof HTMLElement) || node.style.display === "none") {
      continue;
    }
    const copy = node.cloneNode(true) as HTMLElement;
    copy.inert = true;
    copy.setAttribute("aria-hidden", "true");
    copy.dataset[COPY] = "";
    Object.assign(copy.style, {
      position: "absolute",
      top: "0",
      left: "0",
      right: "0",
      pointerEvents: "none",
    });
    copies.push(copy);
  }
  if (copies.length === 0) return;
  if (getComputedStyle(target).position === "static") {
    target.style.position = "relative";
    target.dataset[RELATIVE] = "";
  }
  target.append(...copies);
}

/** Gives an element back its own height, and removes the copies in it. */
function release(el: HTMLElement) {
  el.style.minHeight = "";
  for (const child of [...el.children]) {
    if (child instanceof HTMLElement && isCopy(child)) child.remove();
  }
  if (el.dataset[RELATIVE] !== undefined) {
    el.style.position = "";
    delete el.dataset[RELATIVE];
  }
}
