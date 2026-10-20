import { useLayoutEffect, useRef } from "preact/hooks";

/** The vertical gap between cards. It agrees with the `gap-x-4` of the grid. */
const MASONRY_GAP = 16;

/**
 * Masonry by grid-row span. Each card gets space to reach its natural height,
 * is measured, and then gets a span that matches. Square cards get a span from
 * their width. That makes them square.
 *
 * It writes only the spans that really change. Thus, a `ResizeObserver` can
 * call it without a loop. A pass that finds nothing to change ends the frame at
 * the sizes with which it started. Thus, it causes no new callback. A pass that
 * changes something becomes stable on the next pass.
 */
function spanOf(child: HTMLElement, square: boolean): string {
  // The layout box, not `getBoundingClientRect`, which includes transforms. A
  // card is measured when it arrives, and a card that was just pinned arrives
  // during its animation, scaled up and tilted. Its bounding box is several
  // percent larger than the card. A transform never fires the observer below.
  // Thus, the span that it got stayed as a gap under it.
  return `span ${Math.ceil((square ? child.offsetWidth : child.offsetHeight) + MASONRY_GAP)}`;
}

function applyMasonrySpans(container: HTMLElement, square: boolean) {
  const children = Array.from(container.children) as HTMLElement[];
  const before = children.map((child) => child.style.gridRowEnd);
  for (const child of children) {
    child.style.gridRowEnd = "span 9999";
  }
  // Measured only after each child was released. Thus, the span of one card
  // cannot limit the measurement of the next card.
  const spans = children.map((child) => spanOf(child, square));
  for (const [i, child] of children.entries()) {
    // Each child is written back, also the children whose span does not change,
    // because they are all at `span 9999` now. The release and the restore
    // occur inside one synchronous pass. Thus, nothing is painted between them,
    // and a pass that changes nothing leaves the frame as it was.
    child.style.gridRowEnd = spans[i] ?? "";
  }
  return spans.some((span, i) => span !== before[i]);
}

/**
 * Gives a new span only to the cards that changed size. The items of the grid
 * are aligned to the start of their area. Thus, the height of a card is that of
 * its content, whatever its span, and it can be measured where it is. When the
 * full grid was released and measured for one card, a layout of all cards on
 * the board occurred each time a picture decoded or an auto-save changed the
 * height of a note.
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
 * Gives a grid container a masonry layout and keeps it so. Returns the ref to
 * put on the container.
 *
 * `contents` changes when the set of cards changes: usually the note ids, not
 * the notes. This separates a new measurement from an unrelated render.
 * `AutoNotesView` had this effect with no dependency array. Thus, it measured
 * each child on each keystroke anywhere in the view. The observer below catches
 * a card whose text changes. When the note list itself was the dependency, the
 * full grid was set up again on each auto-save.
 *
 * The children are watched, and also the container, because the height of a
 * card is not stable when it is first measured. An image decodes after the
 * frame that added it. A card measured before its picture arrives gets a span
 * that is a fraction of its final height. In a column layout, that means that
 * the card below draws *through* it. The container is watched for width,
 * because a different width is a different number of columns.
 */
export function useMasonryGrid<T extends HTMLElement>(
  contents: unknown,
  { enabled, square }: { enabled: boolean; square: boolean },
) {
  const ref = useRef<T>(null);

  // A layout effect. Otherwise, a card without a span would show at full height
  // for one frame.
  useLayoutEffect(() => {
    const container = ref.current;
    if (!enabled || !container) return;
    applyMasonrySpans(container, square);

    // A different width is a different set of columns, and each card moves.
    // Otherwise, only the cards that changed size need a new span. The height
    // of the container is ignored. It grows each time the span of a card grows,
    // and a full pass for that reason would undo the purpose of the other path.
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
