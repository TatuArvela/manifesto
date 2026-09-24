import type { RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

/** Past the bar's own height, so its drop shadow leaves the screen too. */
const SHADOW = 8;

/**
 * Lets the top bar scroll away with the board instead of staying put.
 *
 * The board scrolls inside `<main>`, not the page, so the bar cannot simply
 * be left in the flow above it: it would stay where it is whatever the board
 * does. Instead the bar lies over the top of the board (the caller positions
 * it, on phones only) with a spacer of its height at the head of the board,
 * and is moved up by as far as the board has scrolled, up to its own height.
 * It moves exactly as far as the content under it, so it reads as part of it.
 *
 * `hold` brings it back into view whatever the scroll, for as long as it is
 * true: the selection bar lives inside the top bar, and a selection with no
 * way to act on it is no use.
 *
 * Returns the height for the spacer, 0 while `enabled` is off. The offset is
 * written to `--bar-shift` on the bar directly, so scrolling re-renders
 * nothing.
 */
export function useScrollAwayBar(
  scroller: RefObject<HTMLElement>,
  bar: RefObject<HTMLElement>,
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
      // Clamped at 0 as well: an iOS overscroll reports a negative scrollTop.
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
