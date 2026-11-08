import type { RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

/**
 * Keeps the last height of `ref` as its minimum height while `present` is
 * false, after it was true. Thus, content that is built again keeps its space
 * on the screen in the meantime.
 *
 * The editor of a note is built again when the shared document arrives (solo
 * to collab), and its area was empty between the two builds. The panel of the
 * note became short and then tall again. During the open of a note, the grow
 * of the panel followed it down and back up.
 *
 * A layout effect. Thus, the minimum height is set in the same pass in which
 * the content goes, before a paint or a `ResizeObserver` can see the gap.
 */
export function useHeldHeight(
  ref: RefObject<HTMLElement | null>,
  present: boolean,
): void {
  const heightRef = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!present) {
      if (heightRef.current > 0) el.style.minHeight = `${heightRef.current}px`;
      return;
    }
    el.style.minHeight = "";
    const observer = new ResizeObserver(() => {
      heightRef.current = el.offsetHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, present]);
}
