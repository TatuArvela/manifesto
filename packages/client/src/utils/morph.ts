/**
 * The open and close of a note's editor, drawn as the note itself growing into
 * the editor and shrinking back onto its card: the editor panel is laid out
 * where it belongs and transformed to start (or end) over the rectangle it
 * came from, or on a phone uncovered from it (see `morphClip`). Transform,
 * clip and opacity only, so the editor inside is never re-laid out mid-flight.
 */

import { isPhoneLayout } from "./phoneSheets.js";

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * How long either morph runs. Both ways take the same time and follow the same
 * curve: one that moves at once and settles gently, so the editor settles
 * into place opening and onto its card closing. The close once ran the opening
 * curve backwards instead, which barely moved for most of its run and then
 * snapped onto the card, and read as no animation at all.
 */
export const MORPH_MS = 240;
const EASING = "cubic-bezier(0.2, 0, 0, 1)";
/** The share of the run the panel spends fading, at the start or the end. */
const FADE_SHARE = 0.3;

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
 * The clip that shows only the part of an element laid out at `to` that lies
 * over `rect`, with a note's rounded corners.
 *
 * A phone's editor is the whole screen and a card is a fraction of it, in
 * different proportions: scaling one onto the other squashed the note's text
 * to half its width and a quarter of its height, in plain view for most of a
 * close. So there the editor is uncovered where it stands instead, from the
 * card's rectangle out to the screen, and nothing in it changes shape.
 */
export function morphClip(rect: RectLike, to: RectLike): string {
  const top = rect.top - to.top;
  const right = to.left + to.width - (rect.left + rect.width);
  const bottom = to.top + to.height - (rect.top + rect.height);
  const left = rect.left - to.left;
  const radius = getComputedStyle(document.documentElement)
    .getPropertyValue("--note-radius")
    .trim();
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius || "0px"})`;
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
  const to = panel.getBoundingClientRect();
  const [start, end] = isPhoneLayout()
    ? [{ clipPath: morphClip(from, to) }, { clipPath: morphClip(to, to) }]
    : [{ transform: morphTransform(from, to) }, { transform: "none" }];
  panel.style.transformOrigin = "0 0";
  panel.animate(
    [
      { ...start, opacity: opaque ? 1 : 0 },
      { opacity: 1, offset: FADE_SHARE },
      { ...end, opacity: 1 },
    ],
    { duration: MORPH_MS, easing: EASING },
  );
}

/**
 * Shrinks `panel` onto `to`, fading over the last part of the way. Holds the
 * end state, and resolves once it has played, which is when the caller should
 * take the panel down: a timer started beside it runs out first, since the
 * animation only starts on the next frame, and cut the landing off.
 *
 * The fade is its own animation, on linear time: under the shared curve its
 * keyframes would be placed by progress, and a curve that covers most of the
 * distance early would start the fade with the panel still far from the card.
 */
export function morphOut(panel: HTMLElement, to: RectLike): Promise<void> {
  settle(panel);
  const from = panel.getBoundingClientRect();
  const keyframes = isPhoneLayout()
    ? [{ clipPath: morphClip(from, from) }, { clipPath: morphClip(to, from) }]
    : [{ transform: "none" }, { transform: morphTransform(to, from) }];
  panel.style.transformOrigin = "0 0";
  const motion = panel.animate(keyframes, {
    duration: MORPH_MS,
    easing: EASING,
    fill: "forwards",
  });
  panel.animate(
    [{ opacity: 1 }, { opacity: 1, offset: 1 - FADE_SHARE }, { opacity: 0 }],
    { duration: MORPH_MS, fill: "forwards" },
  );
  return motion.finished.then(
    () => {},
    // Cancelled: reopened mid-close, which settles the panel where it stands.
    () => {},
  );
}
