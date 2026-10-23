import type { RefObject } from "preact";
import { useLayoutEffect, useMemo, useState } from "preact/hooks";
import { useMediaQuery } from "./useMediaQuery.ts";

/** Below the `sm` breakpoint of Tailwind, where the icon buttons grow. */
const PHONE_QUERY = "(width < 40rem)";

/**
 * The width of the cards of one grid, read from its first card, and if the
 * buttons have their phone size. All cards of a grid have one width. Thus, one
 * observer serves the full grid, and no card measures itself.
 *
 * `offsetWidth`, not `getBoundingClientRect`: a card leans a little in the
 * grid, and the box of a rotated card is wider than the card. The observer of
 * the card also sees a change to small notes, which changes the number of
 * columns while the grid keeps its width.
 *
 * The same object while nothing changes. Each card reads it from a context, and
 * a new object renders all cards of the grid again for each change to one.
 */
export function useCardRoom(
  gridRef: RefObject<HTMLElement | null>,
  firstId: string | undefined,
): { width: number; phone: boolean } | undefined {
  const phone = useMediaQuery(PHONE_QUERY);
  const [width, setWidth] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    if (firstId === undefined) return;
    const card =
      gridRef.current?.querySelector<HTMLElement>("[data-note-card]");
    if (!card) return;
    const measure = () => {
      // Zero while its view does not show. It is not a width.
      if (card.offsetWidth > 0) setWidth(card.offsetWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [gridRef, firstId]);

  return useMemo(
    () => (width === undefined ? undefined : { width, phone }),
    [width, phone],
  );
}
