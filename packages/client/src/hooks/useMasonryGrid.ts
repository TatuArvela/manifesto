import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

/** Vertical gap between cards — matches the grid's `gap-x-4`. */
const MASONRY_GAP = 16;

/**
 * Masonry by grid-row span: every card is given room to reach its natural
 * height, measured, then given a span that matches. Square cards are spanned
 * by their width instead, which is what makes them square.
 */
function applyMasonrySpans(container: HTMLElement | null, square: boolean) {
  if (!container) return;
  const children = Array.from(container.children) as HTMLElement[];
  for (const child of children) {
    child.style.gridRowEnd = "span 9999";
  }
  // Measured only after every child has been let go, so one card's span can't
  // constrain the next one's measurement.
  const heights = children.map((child) =>
    square
      ? child.getBoundingClientRect().width
      : child.getBoundingClientRect().height,
  );
  for (let i = 0; i < children.length; i++) {
    children[i].style.gridRowEnd =
      `span ${Math.ceil(heights[i] + MASONRY_GAP)}`;
  }
}

/**
 * Lays a grid container out as masonry and keeps it that way, returning the
 * ref to put on the container.
 *
 * `contents` is whatever changes when the cards do — the note list, usually.
 * Passing it is what separates a re-measure from an unrelated re-render:
 * `AutoNotesView` had this effect with no dependency array at all, so it
 * measured every child on every keystroke anywhere in the view.
 */
export function useMasonryGrid<T extends HTMLElement>(
  contents: unknown,
  { enabled, square }: { enabled: boolean; square: boolean },
) {
  const ref = useRef<T>(null);

  // Before paint: an unspanned card would otherwise show at full height for a
  // frame.
  useLayoutEffect(() => {
    if (!enabled) return;
    applyMasonrySpans(ref.current, square);
  }, [contents, enabled, square]);

  // A container that changes width re-flows into a different number of
  // columns, so the spans have to be taken again — window resize, sidebar
  // toggle, an image finishing its load.
  useEffect(() => {
    const container = ref.current;
    if (!enabled || !container) return;

    let width = container.clientWidth;
    const observer = new ResizeObserver((entries) => {
      const now = entries[0]?.contentRect.width;
      if (now === undefined || now === width) return;
      width = now;
      applyMasonrySpans(container, square);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [enabled, square]);

  return ref;
}
