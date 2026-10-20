import type { RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

/**
 * Past the own height of the bar. Thus, its drop shadow also goes off the
 * screen.
 */
const SHADOW = 8;

/**
 * Lets the top bar scroll away with the board, and not stay in place.
 *
 * The board scrolls inside `<main>`, not the page. Thus, the bar cannot stay in
 * the flow above it, because it would stay in place whatever the board does. In
 * place of that, the bar is over the top of the board (the caller positions it,
 * only on phones), with a spacer of its height at the start of the board. The
 * code moves it up by the distance that the board scrolled, up to its own
 * height. It moves exactly as far as the content under it. Thus, it looks like
 * part of it.
 *
 * `hold` brings it back into view, whatever the scroll, while it is true. The
 * selection bar is inside the top bar, and a selection with no way to act on it
 * is of no use.
 *
 * Returns the height for the spacer, 0 while `enabled` is off. The code writes
 * the offset to `--bar-shift` on the bar directly. Thus, a scroll renders
 * nothing again.
 */
export function useScrollAwayBar(
  scroller: RefObject<HTMLElement | null>,
  bar: RefObject<HTMLElement | null>,
  enabled: boolean,
  hold: boolean,
): number {
  const [height, setHeight] = useState(0);
  const heightRef = useRef(0);

  useLayoutEffect(() => {
    const el = bar.current;
    if (!enabled || !el) {
      heightRef.current = 0;
      setHeight(0);
      return;
    }
    const measure = () => {
      heightRef.current = el.offsetHeight;
      setHeight(el.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, bar]);

  useLayoutEffect(() => {
    const el = bar.current;
    const main = scroller.current;
    if (!el || !main) return;
    if (!enabled) {
      el.style.removeProperty("--bar-shift");
      return;
    }
    const place = () => {
      // Also clamped at 0. An overscroll on iOS reports a negative scrollTop.
      const shift = hold
        ? 0
        : Math.min(Math.max(main.scrollTop, 0), heightRef.current + SHADOW);
      el.style.setProperty("--bar-shift", `${shift}px`);
    };
    place();
    main.addEventListener("scroll", place, { passive: true });
    return () => main.removeEventListener("scroll", place);
  }, [enabled, hold, height, scroller, bar]);

  return enabled ? height : 0;
}
