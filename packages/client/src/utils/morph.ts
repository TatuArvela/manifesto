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
  const phone = isPhoneLayout();
  const frames = (source: RectLike, to: RectLike): Keyframe[] => {
    const [start, end] = phone
      ? [{ clipPath: morphClip(source, to) }, { clipPath: morphClip(to, to) }]
      : [{ transform: morphTransform(source, to) }, { transform: "none" }];
    return [
      { ...start, opacity: opaque ? 1 : 0 },
      { opacity: 1, offset: FADE_SHARE },
      { ...end, opacity: 1 },
    ];
  };
  const to = panel.getBoundingClientRect();
  panel.style.transformOrigin = "0 0";
  const motion = panel.animate(frames(from, to), {
    duration: MORPH_MS,
    easing: EASING,
  });
  keepAimed(panel, motion, frames, from, to);
}

/**
 * The rectangle that a morph from `from` to `to` shows at `progress` (after
 * the curve). The same for both kinds: the transform moves the corner and
 * scales the size in proportion, and the insets of the clip change in
 * proportion.
 */
export function shownRect(
  from: RectLike,
  to: RectLike,
  progress: number,
): RectLike {
  const mix = (a: number, b: number) => a + (b - a) * progress;
  return {
    left: mix(from.left, to.left),
    top: mix(from.top, to.top),
    width: mix(from.width, to.width),
    height: mix(from.height, to.height),
  };
}

/**
 * The start from which a morph to `to` shows `shown` at `progress`. Thus, a
 * morph that changes its end goes on from the place where it is on the screen,
 * and does not jump. Its first keyframe is then a rectangle that was never on
 * the screen, possibly with a negative size, but the animation never goes back
 * to that time. Near the end of the curve, the rest of the way is the panel
 * itself.
 */
export function reaimedSource(
  shown: RectLike,
  to: RectLike,
  progress: number,
): RectLike {
  if (progress >= 0.999) return to;
  const back = (s: number, t: number) => (s - t * progress) / (1 - progress);
  return {
    left: back(shown.left, to.left),
    top: back(shown.top, to.top),
    width: back(shown.width, to.width),
    height: back(shown.height, to.height),
  };
}

/**
 * Aims a grow again at the panel each time that its size changes while the
 * grow runs. The panel opens before its content is complete: Milkdown builds
 * its view after the first frame, and images and previews arrive later. The
 * centered dialog then becomes taller and moves up. A transform calculated only
 * at the start went to the old, smaller rectangle, and then jumped to the real
 * one.
 *
 * Only a new end is not sufficient. The curve moves fast at its start, and
 * when the text arrived (approximately 30 ms in), a quarter of the way was
 * already done. With the same start and a new end, the drawn panel jumped by a
 * quarter of the change. Thus, the start changes too (`reaimedSource`), and the
 * panel goes on from where it is on the screen to its new place.
 *
 * A `ResizeObserver` reports after layout and before paint. Thus, the frame
 * that shows the new size already has the new keyframes. The animation keeps
 * its time and its curve. The panel is measured with no keyframes, because its
 * box with the transform applied is not its layout.
 */
function keepAimed(
  panel: HTMLElement,
  motion: Animation,
  frames: (source: RectLike, to: RectLike) => Keyframe[],
  from: RectLike,
  to: RectLike,
) {
  const effect = motion.effect;
  if (!(effect instanceof KeyframeEffect)) return;
  if (typeof ResizeObserver !== "function") return;
  let source = from;
  let aim = to;
  const observer = new ResizeObserver(() => {
    // The size of the layout box. A transform or a clip does not change it.
    const moved =
      Math.abs(panel.offsetWidth - aim.width) >= 1 ||
      Math.abs(panel.offsetHeight - aim.height) >= 1;
    if (!moved) return;
    // The progress after the curve, which is what the keyframes interpolate.
    const progress = effect.getComputedTiming().progress ?? 0;
    const shown = shownRect(source, aim, progress);
    effect.setKeyframes([]);
    aim = panel.getBoundingClientRect();
    source = reaimedSource(shown, aim, progress);
    effect.setKeyframes(frames(source, aim));
  });
  observer.observe(panel);
  const stop = () => observer.disconnect();
  // Cancelled (`settle`, a close during the open) or complete.
  motion.finished.then(stop, stop);
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
