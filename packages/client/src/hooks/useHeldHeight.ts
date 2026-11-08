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
        for (const { target, removedNodes } of records) {
          if (removedNodes.length === 0 || !(target instanceof HTMLElement)) {
            continue;
          }
          const height = last.get(target) ?? 0;
          if (height > 0 && !target.style.minHeight) {
            target.style.minHeight = `${height}px`;
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
  // follows a setting).
  useLayoutEffect(() => {
    const watch = watchRef.current;
    if (!watch) return;
    for (const ref of refs) {
      const el = ref.current;
      if (!el || watch.watched.has(el)) continue;
      watch.watched.add(el);
      watch.last.set(el, el.offsetHeight);
      watch.sizes.observe(el);
      watch.removals.observe(el, { childList: true });
    }
  });

  // Only on a new editor.
  useLayoutEffect(() => {
    if (!editor) return;
    for (const ref of refsRef.current) {
      const el = ref.current;
      if (el) el.style.minHeight = "";
    }
  }, [editor]);
}
