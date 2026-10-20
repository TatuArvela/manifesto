/**
 * The open and close of the editor of a note, drawn as the note itself that
 * grows into the editor and shrinks back onto its card. The editor panel is
 * laid out where it belongs, and transformed to start (or end) over the
 * rectangle from which it came, or on a phone uncovered from it (see
 * `morphClip`). Only transform, clip and opacity. Thus, the layout of the
 * editor inside never changes during the animation.
 */

import { isPhoneLayout } from "./phoneSheets.ts";

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * How long each morph runs. Both directions take the same time and follow the
 * same curve: a curve that moves immediately and stops smoothly. Thus, the
 * editor goes smoothly into place when it opens, and onto its card when it
 * closes. Before, the close ran the curve of the open backward. That almost did
 * not move for most of its time, then jumped onto the card, and looked like no
 * animation.
 */
export const MORPH_MS = 240;
const EASING = "cubic-bezier(0.2, 0, 0, 1)";
/**
 * The part of the run during which the panel fades, at the start or the end.
 */
const FADE_SHARE = 0.3;

/**
 * The transform that draws an element laid out at `to` over `from`, with
 * `transform-origin` at its top left.
 */
export function morphTransform(from: RectLike, to: RectLike): string {
  const scaleX = to.width > 0 ? from.width / to.width : 1;
  const scaleY = to.height > 0 ? from.height / to.height : 1;
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${scaleX}, ${scaleY})`;
}

/**
 * The clip that shows only the part of an element laid out at `to` that is over
 * `rect`, with the rounded corners of a note.
 *
 * The editor of a phone is the full screen, and a card is a fraction of it, in
 * different proportions. A scale of one onto the other squashed the text of the
 * note to half its width and a quarter of its height, clearly visible for most
 * of a close. Thus, there the editor is uncovered where it is, from the
 * rectangle of the card out to the screen, and nothing in it changes shape.
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
 * If a rectangle is a good start for a morph: a part of it is on the screen,
 * and it is not collapsed. With a card scrolled out of sight, or opened from a
 * notification while the grid is in a different place, the editor would come in
 * from off the page.
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
 * Ends a morph that still runs (or is held at its end). Thus, the panel is
 * measured where it is laid out, not at a point during the animation. A close
 * during the open is only one press.
 */
export function settle(panel: HTMLElement) {
  for (const animation of panel.getAnimations()) animation.cancel();
}

/**
 * Grows `panel` out of `from` into its layout position.
 *
 * By default, it starts transparent over the source, which fades out under it.
 * Thus, the two cross there, and one does not suddenly show over the other. A
 * source that disappears immediately (the sheet peeled off the new-note pad)
 * asks for `opaque`. Thus, there is no moment with neither on the screen.
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
 * Shrinks `panel` onto `to`, and fades over the last part of the way. Keeps the
 * end state, and resolves after it played. Then the caller must remove the
 * panel. A timer started next to it ends first, because the animation only
 * starts on the next frame, and cut off the landing.
 *
 * The fade is its own animation, on linear time. Under the shared curve, its
 * keyframes would be placed by progress, and a curve that covers most of the
 * distance early would start the fade while the panel is still far from the
 * card.
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
    // Cancelled: opened again during the close, which stops the panel where it
    // is.
    () => {},
  );
}
