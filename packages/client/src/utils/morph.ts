/**
 * The open and close of a note's editor, drawn as the note itself growing into
 * the editor and shrinking back onto its card: the editor panel is laid out
 * where it belongs and transformed to start (or end) over the rectangle it
 * came from. Transform and opacity only, so it runs on the compositor and the
 * editor inside is never re-laid out mid-flight.
 */

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

const OPEN_MS = 240;
const CLOSE_MS = 180;

/** How long `morphOut` runs, so the caller can take the panel down after. */
export const MORPH_CLOSE_MS = CLOSE_MS;

/**
 * The transform that draws an element laid out at `to` over `from` instead,
 * with `transform-origin` at its top left.
 */
export function morphTransform(from: RectLike, to: RectLike): string {
  const scaleX = to.width > 0 ? from.width / to.width : 1;
  const scaleY = to.height > 0 ? from.height / to.height : 1;
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${scaleX}, ${scaleY})`;
}

/**
 * Whether a rectangle is worth morphing from: some of it on screen, and not
 * collapsed. A card scrolled out of sight, or opened from a notification while
 * the grid is somewhere else, would have the editor fly in from off the page.
 */
export function isMorphSource(
  rect: RectLike | null | undefined,
  viewport: { width: number; height: number },
): rect is RectLike {
  if (!rect || rect.width < 1 || rect.height < 1) return false;
  return (
    rect.left < viewport.width &&
    rect.top < viewport.height &&
    rect.left + rect.width > 0 &&
    rect.top + rect.height > 0
  );
}

export function viewportSize() {
  return {
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  };
}

/**
 * Ends a morph still running (or held at its end), so the panel is measured where it is laid out
 * rather than part way through: closing during the open is one press away.
 */
export function settle(panel: HTMLElement) {
  for (const animation of panel.getAnimations()) animation.cancel();
}

/**
 * Grows `panel` out of `from` into where it is laid out.
 *
 * By default it starts clear over the source, which fades out underneath it,
 * so the two cross over there rather than one popping over the other. A source
 * that vanishes at once instead (the sheet peeled off the new-note pad) asks
 * for `opaque`, so there is no moment with neither on screen.
 */
export function morphIn(
  panel: HTMLElement,
  from: RectLike,
  { opaque = false }: { opaque?: boolean } = {},
): void {
  settle(panel);
  const start = morphTransform(from, panel.getBoundingClientRect());
  panel.style.transformOrigin = "0 0";
  panel.animate(
    [
      { transform: start, opacity: opaque ? 1 : 0 },
      { opacity: 1, offset: 0.3 },
      { transform: "none", opacity: 1 },
    ],
    { duration: OPEN_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  );
}

/** Shrinks `panel` onto `to`, fading as it lands. Holds the end state. */
export function morphOut(panel: HTMLElement, to: RectLike): void {
  settle(panel);
  const end = morphTransform(to, panel.getBoundingClientRect());
  panel.style.transformOrigin = "0 0";
  panel.animate(
    [
      { transform: "none", opacity: 1 },
      { opacity: 1, offset: 0.55 },
      { transform: end, opacity: 0 },
    ],
    {
      duration: CLOSE_MS,
      easing: "cubic-bezier(0.3, 0, 0.8, 0.15)",
      fill: "forwards",
    },
  );
}
