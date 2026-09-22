import { useLayoutEffect, useRef } from "preact/hooks";

/** Vertical gap between cards; matches the grid's `gap-x-4`. */
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
function spanOf(child: HTMLElement, square: boolean): string {
  // The layout box, not `getBoundingClientRect`, which includes transforms. A
  // card is measured the moment it arrives, and a card that has just been
  // pinned arrives mid-animation, scaled up and tilted: its bounding box is
  // several percent larger than the card, and since a transform never fires
  // the observer below, the span it was given stayed as a gap under it.
  return `span ${Math.ceil((square ? child.offsetWidth : child.offsetHeight) + MASONRY_GAP)}`;
}

function applyMasonrySpans(container: HTMLElement, square: boolean) {
  const children = Array.from(container.children) as HTMLElement[];
  const before = children.map((child) => child.style.gridRowEnd);
  for (const child of children) {
    child.style.gridRowEnd = "span 9999";
  }
  // Measured only after every child has been let go, so one card's span can't
  // constrain the next one's measurement.
  const spans = children.map((child) => spanOf(child, square));
  for (let i = 0; i < children.length; i++) {
    // Every child is written back, including the ones whose span is unchanged
    // because they are all sitting at `span 9999` right now. The release and the
    // restore happen inside one synchronous pass, so nothing is painted in
    // between and a pass that changes nothing leaves the frame as it found it.
    children[i].style.gridRowEnd = spans[i];
  }
  return spans.some((span, i) => span !== before[i]);
}

/**
 * Re-spans only the cards that changed size. The grid's items are aligned to
 * the start of their area, so a card's height is its content's whatever span
 * it holds, and it can be measured where it stands. Releasing and measuring
 * the whole grid for one card forced a layout of every card on the board each
 * time a picture decoded or an auto-save changed a note's height.
 */
function applyChangedSpans(
  container: HTMLElement,
  changed: Element[],
  square: boolean,
) {
  for (const el of changed) {
    if (el.parentElement !== container) continue;
    const child = el as HTMLElement;
    const span = spanOf(child, square);
    if (child.style.gridRowEnd !== span) child.style.gridRowEnd = span;
  }
}

/**
 * Lays a grid container out as masonry and keeps it that way, returning the
 * ref to put on the container.
 *
 * `contents` changes when the set of cards does: the note ids, usually, not
 * the notes. Passing it is what separates a re-measure from an unrelated
 * re-render: `AutoNotesView` had this effect with no dependency array at all,
 * so it measured every child on every keystroke anywhere in the view. A card
 * whose text changes is caught by the observer below instead, so passing the
 * note list itself set the whole grid up again on every auto-save.
 *
 * The children are watched as well as the container, because a card's height
 * is not settled when it is first measured: an image decodes after the frame
 * that added it, and a card measured before its picture arrives is given a
 * span a fraction of its eventual height, which in a column layout means the
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

    // A different width is a different set of columns, and every card moves;
    // otherwise only the cards that resized need a new span. The container's
    // height is ignored: it grows whenever a card's span does, and treating
    // that as a reason for a full pass would undo the point of the other path.
    let width = container.getBoundingClientRect().width;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = container.getBoundingClientRect().width;
      if (nextWidth !== width) {
        width = nextWidth;
        applyMasonrySpans(container, square);
        return;
      }
      applyChangedSpans(
        container,
        entries.map((entry) => entry.target),
        square,
      );
    });
    observer.observe(container);
    for (const child of Array.from(container.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [contents, enabled, square]);

  return ref;
}
