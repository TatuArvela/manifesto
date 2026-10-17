import type { RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

/**
 * The width of one grid column, read off a hidden ruler: a grid laid out like
 * the board's, holding one empty cell. `undefined` until it has been measured.
 *
 * A layout effect, not an effect: whatever takes this width has none of its
 * own until it runs, so measuring after paint leaves it stretched across the
 * whole column area for a frame, very visible on leaving the search view,
 * which remounts the composer with the width unknown again. A zero reading is
 * ignored rather than applied: the ruler measures nothing while its view is
 * not the one shown, and 0px would collapse what it sizes when it comes back.
 *
 * Measured again whenever `measuring` turns true. `App` keeps the composer
 * mounted in the archive, trash and reminders views, where there is no ruler;
 * mounted in one of those, it would come back to the notes view never measured.
 */
export function useColumnWidth(measuring: boolean): {
  rulerRef: RefObject<HTMLDivElement | null>;
  width: number | undefined;
} {
  const rulerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    if (!measuring) return;
    const ruler = rulerRef.current;
    if (!ruler) return;
    const cell = ruler.firstElementChild as HTMLElement;
    if (!cell) return;
    const measure = () => {
      const measured = cell.getBoundingClientRect().width;
      if (measured > 0) setWidth(measured);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(ruler);
    // The cell too: switching to small notes changes the column count, which
    // narrows the cell while the ruler keeps its width.
    observer.observe(cell);
    return () => observer.disconnect();
  }, [measuring]);

  return { rulerRef, width };
}
