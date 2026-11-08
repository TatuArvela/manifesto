/**
 * The open and close of the editor of a note, drawn as the note itself that
 * grows into the editor and shrinks back onto its card. The editor panel is
 * laid out where it belongs, and drawn over the rectangle from which it came
 * (`morphFrame`). Only transform, clip and opacity. Thus, the layout of the
 * editor inside never changes during the animation.
 *
 * The drawn rectangle moves in a straight line from the card to the panel: the
 * keyframes are points on that line (`pathFrames`), and the curve of the run
 * moves along them.
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
 * The part of the run during which a panel that is not opaque fades, at the
 * start or the end.
 */
const FADE_SHARE = 0.3;
/**
 * The points on the path of a morph. Between two points, the scale and the clip
 * change separately, and the drawn rectangle is off the straight line by a
 * fraction of a pixel.
 */
const PATH_POINTS = 8;

/**
 * The clip that shows only the part of an element laid out at `to` that is over
 * `rect`, with corners of `radius`. In the own pixels of the element: an
 * element drawn at `scale` gets its radius divided by it, so that the corners
 * on the screen keep the radius of a note.
 */
export function morphClip(
  rect: RectLike,
  to: RectLike,
  radius: string,
  scale = 1,
): string {
  const top = rect.top - to.top;
  const right = to.left + to.width - (rect.left + rect.width);
  const bottom = to.top + to.height - (rect.top + rect.height);
  const left = rect.left - to.left;
  const round = scale === 1 ? radius : `calc(${radius} / ${scale})`;
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${round})`;
}

/**
 * The keyframe that draws an element laid out at `to` exactly over `rect`, with
 * `transform-origin` at its top left.
 *
 * - On a wider screen, the element is scaled by one factor, the larger of the
 *   two ratios, and the part that does not fit is clipped away at its right or
 *   bottom. A scale with two factors squashed the text of the note (to 0.56 of
 *   its width and 0.43 of its height, for a usual card), and a fade hid that.
 *   Now the card grows into the editor, and the text keeps its shape.
 * - The editor of a phone is the full screen, and a card is a fraction of it.
 *   Even a scale with one factor made its text very small. Thus, there the
 *   editor is only uncovered where it is, from the rectangle of the card out to
 *   the screen.
 */
export function morphFrame(
  rect: RectLike,
  to: RectLike,
  phone: boolean,
  radius: string,
): Keyframe {
  if (phone) return { clipPath: morphClip(rect, to, radius) };
  const ratioX = to.width > 0 ? rect.width / to.width : 1;
  const ratioY = to.height > 0 ? rect.height / to.height : 1;
  const scale = Math.max(ratioX, ratioY, 0.001);
  // The part of the element that is drawn over `rect`, in its own pixels.
  const part = {
    left: to.left,
    top: to.top,
    width: rect.width / scale,
    height: rect.height / scale,
  };
  return {
    transform: `translate(${rect.left - to.left}px, ${rect.top - to.top}px) scale(${scale})`,
    clipPath: morphClip(part, to, radius, scale),
  };
}

/**
 * The rectangle at `progress` on the straight line from `from` to `to`.
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

/** A straight line that a morph draws an element along. */
export interface MorphPath {
  /** Where the drawn rectangle is at `startAt`. */
  start: RectLike;
  /** Where it is at the end. */
  end: RectLike;
  /** Where the element is laid out. */
  layout: RectLike;
  /**
   * The progress (after the curve) at which the line starts. Not 0 for a grow
   * aimed again while it ran: the new line starts where the panel is.
   */
  startAt: number;
}

/**
 * The keyframes of `path`, as points on its line. Before `startAt`, the
 * keyframes stay at the start of the line. The animation never goes back
 * there.
 */
export function pathFrames(
  path: MorphPath,
  phone: boolean,
  radius: string,
  opacity?: ((offset: number) => number) | undefined,
): Keyframe[] {
  const { start, end, layout, startAt } = path;
  const at = (offset: number, rect: RectLike): Keyframe => ({
    ...morphFrame(rect, layout, phone, radius),
    ...(opacity && { opacity: opacity(offset) }),
    offset,
  });
  const frames: Keyframe[] = startAt > 0 ? [at(0, start)] : [];
  for (let i = 0; i <= PATH_POINTS; i++) {
    const along = i / PATH_POINTS;
    frames.push(
      at(startAt + (1 - startAt) * along, shownRect(start, end, along)),
    );
  }
  return frames;
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

/** The corner radius of a note, which the clip of a morph keeps. */
function noteRadius(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--note-radius")
      .trim() || "0px"
  );
}

/**
 * Ends a morph that still runs (or is held at its end). Thus, the panel is
 * measured where it is laid out, not at a point during the animation. A close
 * during the open is only one press.
 */
export function settle(panel: HTMLElement) {
  following.get(panel)?.();
  for (const animation of panel.getAnimations()) animation.cancel();
}

/** The stop of the watch of `keepAimed` on each panel that has one. */
const following = new WeakMap<HTMLElement, () => void>();

/**
 * How long after a grow the panel still follows its content. A size change in
 * that time animates from the old size. Images, link previews and the shared
 * document of a note on a server can arrive after the grow, and the centered
 * panel jumped at each one.
 */
export const MORPH_FOLLOW_MS = 1000;

/**
 * Grows `panel` out of `from` into its layout position.
 *
 * A card asks for `opaque`: the panel starts exactly over the card, and the
 * card hides when it starts to move (`onStart`). Thus, nothing fades, and the
 * card itself seems to grow. By default, the panel starts transparent and
 * fades in over the first part of the way (the composer, over its pad).
 */
export function morphIn(
  panel: HTMLElement,
  from: RectLike,
  {
    opaque = false,
    ready,
    onStart,
  }: {
    opaque?: boolean;
    ready?: Promise<void> | undefined;
    /**
     * The grow starts to move: at once, or when `ready` lets it. The source
     * hides from this time. If it went at the open, it was gone while the grow
     * still waited, and nothing was on the screen.
     */
    onStart?: (() => void) | undefined;
  } = {},
): void {
  settle(panel);
  const phone = isPhoneLayout();
  const radius = noteRadius();
  const opacity = opaque
    ? undefined
    : (offset: number) => Math.min(1, offset / FADE_SHARE);
  const to = panel.getBoundingClientRect();
  panel.style.transformOrigin = "0 0";
  const path = { start: from, end: to, layout: to, startAt: 0 };
  const motion = panel.animate(pathFrames(path, phone, radius, opacity), {
    duration: MORPH_MS,
    easing: EASING,
  });
  keepAimed(panel, motion, path, {
    phone,
    // The fade belongs to the grow. A later size change is opaque.
    frames: (next, grow) =>
      pathFrames(next, phone, radius, grow ? opacity : undefined),
  });
  if (ready) holdUntil(motion, ready, onStart);
  else onStart?.();
}

/**
 * The longest time that a grow waits for its content (`ready`). An editor that
 * takes longer grows from what is there, and `keepAimed` follows it.
 */
export const MORPH_READY_WAIT_MS = 150;

/**
 * Holds a grow at its first frame (over the source) until its content is
 * there. Milkdown builds its view after the first frame. A grow that started
 * at once went to the empty panel first, and then to the full one. When the
 * empty panel was centered lower than the card, the grow went down, and then
 * back up. `keepAimed` still follows the panel while it is held, and at the
 * progress 0 that changes only the end.
 */
function holdUntil(
  motion: Animation,
  ready: Promise<void>,
  onStart: (() => void) | undefined,
) {
  motion.pause();
  let go = () => {
    go = () => {};
    clearTimeout(timer);
    // Cancelled while it waited (a close): it stays cancelled.
    if (motion.playState !== "paused") return;
    motion.play();
    onStart?.();
  };
  const timer = setTimeout(() => go(), MORPH_READY_WAIT_MS);
  void ready.then(
    () => go(),
    () => go(),
  );
}

/**
 * Aims a grow again at the panel each time that its size changes while the
 * grow runs, and animates each size change for `MORPH_FOLLOW_MS` after it.
 * The panel opens before its content is complete: images and previews arrive
 * after the editor. The centered dialog then becomes taller and moves up. A
 * grow calculated only at the start went to the old, smaller rectangle, and
 * then jumped to the real one.
 *
 * During a run, the new line starts where the panel is drawn now, at the
 * current progress. With the old start and only a new end, the drawn panel
 * jumped: the curve is fast at its start, and a part of the way was already
 * done. After a run, a new run goes from the old layout to the new one. Not on
 * a phone, where the sheet is in the flow of the page: a taller sheet does not
 * move what is on the screen.
 *
 * A `ResizeObserver` reports after layout and before paint. Thus, the frame
 * that shows the new size already has the new keyframes. The panel is measured
 * with no keyframes, because its box with the transform applied is not its
 * layout. `settle` stops the watch, so that a close is never aimed again.
 */
function keepAimed(
  panel: HTMLElement,
  grow: Animation,
  first: MorphPath,
  {
    phone,
    frames,
  }: {
    phone: boolean;
    frames: (path: MorphPath, grow: boolean) => Keyframe[];
  },
) {
  if (typeof ResizeObserver !== "function") return;
  let motion = grow;
  let path = first;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new ResizeObserver(() => {
    // The size of the layout box. A transform or a clip does not change it.
    const moved =
      Math.abs(panel.offsetWidth - path.layout.width) >= 1 ||
      Math.abs(panel.offsetHeight - path.layout.height) >= 1;
    const effect = motion.effect;
    if (!moved || !(effect instanceof KeyframeEffect)) return;
    if (motion.playState !== "finished") {
      // The progress after the curve, which is what the keyframes interpolate.
      const progress = Math.min(
        effect.getComputedTiming().progress ?? 0,
        0.999,
      );
      const along = (progress - path.startAt) / (1 - path.startAt);
      const shown = shownRect(path.start, path.end, Math.max(0, along));
      effect.setKeyframes([]);
      const layout = panel.getBoundingClientRect();
      path = { start: shown, end: layout, layout, startAt: progress };
      effect.setKeyframes(frames(path, motion === grow));
      return;
    }
    const layout = panel.getBoundingClientRect();
    if (phone) {
      path = { start: layout, end: layout, layout, startAt: 0 };
      return;
    }
    path = { start: path.layout, end: layout, layout, startAt: 0 };
    motion = panel.animate(frames(path, false), {
      duration: MORPH_MS,
      easing: EASING,
    });
  });
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    if (following.get(panel) === stop) following.delete(panel);
  };
  following.set(panel, stop);
  observer.observe(panel);
  grow.finished.then(
    () => {
      timer = setTimeout(stop, MORPH_FOLLOW_MS);
    },
    // Cancelled: `settle` (a close during the open), which also stops it.
    stop,
  );
}

/**
 * Shrinks `panel` onto `to`. Keeps the end state, and resolves after it
 * played. Then the caller must remove the panel. A timer started next to it
 * ends first, because the animation only starts on the next frame, and cut off
 * the landing.
 *
 * A card asks for no `fade`: the panel lands exactly on the card, and the card
 * shows when the panel goes. By default, the panel fades over the last part of
 * the way. That fade is its own animation, on linear time. Under the shared
 * curve, its keyframes would be placed by progress, and a curve that covers
 * most of the distance early would start the fade while the panel is still far
 * from its target.
 */
export function morphOut(
  panel: HTMLElement,
  to: RectLike,
  { fade = true }: { fade?: boolean } = {},
): Promise<void> {
  settle(panel);
  const from = panel.getBoundingClientRect();
  panel.style.transformOrigin = "0 0";
  const path = { start: from, end: to, layout: from, startAt: 0 };
  const motion = panel.animate(
    pathFrames(path, isPhoneLayout(), noteRadius()),
    { duration: MORPH_MS, easing: EASING, fill: "forwards" },
  );
  if (fade) {
    panel.animate(
      [{ opacity: 1 }, { opacity: 1, offset: 1 - FADE_SHARE }, { opacity: 0 }],
      { duration: MORPH_MS, fill: "forwards" },
    );
  }
  return motion.finished.then(
    () => {},
    // Cancelled: opened again during the close, which stops the panel where it
    // is.
    () => {},
  );
}
