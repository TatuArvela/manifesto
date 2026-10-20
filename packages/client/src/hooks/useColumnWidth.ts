import type { RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

/**
 * The width of one grid column, read from a hidden ruler: a grid with the same
 * layout as the board, with one empty cell. `undefined` until it is measured.
 *
 * A layout effect, not an effect. The element that takes this width has no
 * width of its own until it runs. Thus, a measurement after paint leaves it
 * stretched across the full column area for one frame. This is very visible
 * when you leave the search view, which mounts the composer again with the
 * width unknown. The code ignores a zero reading, and does not apply it. The
 * ruler measures nothing while its view does not show, and 0px would collapse
 * what it sizes when it comes back.
 *
 * Measured again each time `measuring` becomes true. `App` keeps the composer
 * mounted in the archive, trash and reminders views, where there is no ruler.
 * Mounted in one of those, it would come back to the notes view never measured.
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
    // Also the cell. A change to small notes changes the number of columns,
    // which makes the cell narrower, while the ruler keeps its width.
    observer.observe(cell);
    return () => observer.disconnect();
  }, [measuring]);

  return { rulerRef, width };
}
