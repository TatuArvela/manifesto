import { useLayoutEffect, useRef } from "preact/hooks";

/** Vertical gap between cards — matches the grid's `gap-x-4`. */
const MASONRY_GAP = 16;

/**
 * Masonry by grid-row span: every card is given room to reach its natural
 * height, measured, then given a span that matches. Square cards are spanned
 * by their width instead, which is what makes them square.
 *
 * Writes only the spans that actually change. That is what lets this be called
 * from a `ResizeObserver` without looping: a pass that finds nothing to change
 * ends the frame at the sizes it started it with, so it provokes no further
 * callback, and a pass that does change something converges on the next one.
 */
function applyMasonrySpans(container: HTMLElement, square: boolean) {
  const children = Array.from(container.children) as HTMLElement[];
  const before = children.map((child) => child.style.gridRowEnd);
  for (const child of children) {
    child.style.gridRowEnd = "span 9999";
  }
  // Measured only after every child has been let go, so one card's span can't
  // constrain the next one's measurement.
  const spans = children.map((child) => {
    const rect = child.getBoundingClientRect();
    return `span ${Math.ceil((square ? rect.width : rect.height) + MASONRY_GAP)}`;
  });
  for (let i = 0; i < children.length; i++) {
    // Every child is written back, including the ones whose span is unchanged
    // — they are all sitting at `span 9999` right now. The release and the
    // restore happen inside one synchronous pass, so nothing is painted in
    // between and a pass that changes nothing leaves the frame as it found it.
    children[i].style.gridRowEnd = spans[i];
  }
  return spans.some((span, i) => span !== before[i]);
}

/**
 * Lays a grid container out as masonry and keeps it that way, returning the
 * ref to put on the container.
 *
 * `contents` is whatever changes when the cards do — the note list, usually.
 * Passing it is what separates a re-measure from an unrelated re-render:
 * `AutoNotesView` had this effect with no dependency array at all, so it
 * measured every child on every keystroke anywhere in the view.
 *
 * The children are watched as well as the container, because a card's height
 * is not settled when it is first measured: an image decodes after the frame
 * that added it, and a card measured before its picture arrives is given a
 * span a fraction of its eventual height — which in a column layout means the
 * card below is drawn *through* it. The container is watched for width, since
 * a different width is a different number of columns.
 */
export function useMasonryGrid<T extends HTMLElement>(
  contents: unknown,
  { enabled, square }: { enabled: boolean; square: boolean },
) {
  const ref = useRef<T>(null);

  // A layout effect: an unspanned card would otherwise show at full height for
  // a frame.
  useLayoutEffect(() => {
    const container = ref.current;
    if (!enabled || !container) return;
    applyMasonrySpans(container, square);

    const observer = new ResizeObserver(() => {
      applyMasonrySpans(container, square);
    });
    observer.observe(container);
    for (const child of Array.from(container.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [contents, enabled, square]);

  return ref;
}
