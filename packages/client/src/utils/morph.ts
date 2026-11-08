/**
 * The open and close of the editor of a note, drawn as the note itself that
 * grows into the editor and shrinks back onto its card. The editor panel is
 * laid out where it belongs, and drawn over the rectangle from which it came.
 * Thus, the layout of the editor inside never changes during the animation.
 *
 * Only `transform` (and `opacity` for the composer) moves, because only those
 * run on the compositor in all browsers. A `clip-path` animation can need the
 * main thread, and the main thread is busy while a note opens: the editor
 * builds, the shared document arrives, images decode. Each long frame then
 * stopped the motion.
 *
 * It is a container transform (`morphFrames`). The panel moves and scales to
 * the rectangle, and clips its content to its own box (`overflow: clip` while
 * it runs). Its first child, the content (`.note-sheet-content`), has the
 * inverse scale. Thus, the window grows and slides, and the text in it keeps
 * its size the whole way.
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
 * How much the scale may change between two points on the path of a morph, on
 * each axis. Between two points, the scale of the panel and the inverse scale
 * of its content each change linearly, and their product is not exactly 1. The
 * error depends on the ratio of the two scales: with 6%, the content is off its
 * size by less than 0.1% (under a pixel on the editor). Points at an even
 * distance were off by 0.8% near the card, where the scale is small.
 */
const POINT_RATIO = 1.06;
/** The longest step between two points, which also places the fade. */
const POINT_STEP = 1 / 8;
/** A limit on the points of one path, for a card that is very small. */
const MAX_POINTS = 96;

/**
 * Where the points of a path are, as parts of the way from its start (0) to
 * its end (1): close enough that the scale changes by at most `POINT_RATIO`
 * between two of them on each axis.
 */
export function pathPoints(path: MorphPath): number[] {
  const { start, end, layout } = path;
  const axes = [
    [start.width, end.width, layout.width],
    [start.height, end.height, layout.height],
  ].map(([from = 0, to = 0, size = 0]) =>
    size > 0 ? [from / size, to / size] : [1, 1],
  );
  const points = [0];
  let along = 0;
  while (along < 1 && points.length < MAX_POINTS) {
    let next = Math.min(1, along + POINT_STEP);
    for (const [from = 1, to = 1] of axes) {
      const now = from + (to - from) * along;
      if (to === from || now <= 0) continue;
      const limit = to > from ? now * POINT_RATIO : now / POINT_RATIO;
      next = Math.min(next, (limit - from) / (to - from));
    }
    along = next > along ? next : 1;
    points.push(along);
  }
  if (points.at(-1) !== 1) points.push(1);
  return points;
}

/** The keyframes that draw a panel over a rectangle. */
export interface MorphFrame {
  /** For the panel: moved and scaled onto the rectangle. */
  panel: Keyframe;
  /** For its content: the inverse scale, so that the text keeps its size. */
  content: Keyframe;
  /**
   * For the corners of the panel, when a note has round corners. Its own
   * animation: an animation runs on the compositor only when all of its
   * properties can, and `border-radius` cannot.
   */
  corners: Keyframe | null;
}

/**
 * The keyframes that draw a panel laid out at `to` over `rect`, with
 * `transform-origin` at the top left of both.
 *
 * The text of a card and of the editor have the same size, and the title the
 * same place. Thus, the content is never scaled: only the window that shows it.
 * A scale of the content (to 0.56 for a usual card) made the text small at the
 * start, then large again, most of it in the first 60 ms.
 *
 * `radius` keeps the corners of the window round on the screen: the radius of
 * the panel is divided by its scale on each axis. `scrollTop` keeps a panel
 * that was scrolled (a close of a long note) where it was, because the clip
 * resets its scroll.
 */
export function morphFrames(
  rect: RectLike,
  to: RectLike,
  radius: number,
  scrollTop: number,
): MorphFrame {
  const scaleX = Math.max(to.width > 0 ? rect.width / to.width : 1, 0.001);
  const scaleY = Math.max(to.height > 0 ? rect.height / to.height : 1, 0.001);
  return {
    panel: {
      transform: `translate(${rect.left - to.left}px, ${rect.top - to.top}px) scale(${scaleX}, ${scaleY})`,
    },
    content: {
      transform: `scale(${1 / scaleX}, ${1 / scaleY}) translate(0px, ${-scrollTop}px)`,
    },
    corners:
      radius > 0
        ? { borderRadius: `${radius / scaleX}px / ${radius / scaleY}px` }
        : null,
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

/** A straight line that a morph draws a panel along. */
export interface MorphPath {
  /** Where the drawn rectangle is at `startAt`. */
  start: RectLike;
  /** Where it is at the end. */
  end: RectLike;
  /** Where the panel is laid out. */
  layout: RectLike;
  /**
   * The progress (after the curve) at which the line starts. Not 0 for a grow
   * aimed again while it ran: the new line starts where the panel is.
   */
  startAt: number;
}

/** The keyframes of a path, for the panel, its content and its corners. */
export interface PathFrames {
  panel: Keyframe[];
  content: Keyframe[];
  /** Empty when a note has square corners. */
  corners: Keyframe[];
}

/**
 * The keyframes of `path`, as points on its line. Before `startAt`, the
 * keyframes stay at the start of the line. The animation never goes back
 * there.
 */
export function pathFrames(
  path: MorphPath,
  radius: number,
  scrollTop: number,
  opacity?: ((offset: number) => number) | undefined,
): PathFrames {
  const { start, end, layout, startAt } = path;
  const frames: PathFrames = { panel: [], content: [], corners: [] };
  const at = (offset: number, rect: RectLike) => {
    const frame = morphFrames(rect, layout, radius, scrollTop);
    frames.panel.push({
      ...frame.panel,
      ...(opacity && { opacity: opacity(offset) }),
      offset,
    });
    frames.content.push({ ...frame.content, offset });
    if (frame.corners) frames.corners.push({ ...frame.corners, offset });
  };
  if (startAt > 0) at(0, start);
  for (const along of pathPoints(path)) {
    at(startAt + (1 - startAt) * along, shownRect(start, end, along));
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

/** The corner radius of a note in pixels, which the window of a morph keeps. */
function noteRadius(): number {
  const root = getComputedStyle(document.documentElement);
  const value = root.getPropertyValue("--note-radius").trim();
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return 0;
  return value.endsWith("rem")
    ? number * Number.parseFloat(root.fontSize)
    : number;
}

/** The content of a panel, which takes the inverse scale. */
function contentOf(panel: HTMLElement): HTMLElement | null {
  const first = panel.firstElementChild;
  return first instanceof HTMLElement ? first : null;
}

/**
 * One run of a morph: the animation of the panel, and the one of its content
 * with the same timing. The panel decides the state and the progress.
 */
interface Run {
  panel: Animation;
  content: Animation | null;
  corners: Animation | null;
  /** The scroll of the panel before the clip reset it. */
  scrollTop: number;
}

/** The runs of each panel, which `settle` cancels. */
const runs = new WeakMap<HTMLElement, Run>();
/** The stop of the watch of `keepAimed` on each panel that has one. */
const following = new WeakMap<HTMLElement, () => void>();

/**
 * Starts a run along `path`. The panel clips its content while the run lasts,
 * and gets its overflow and its scroll back when the run ends. A run that keeps
 * its end (`fill`, a close) keeps the clip: the panel goes after it.
 */
function startRun(
  panel: HTMLElement,
  frames: (scrollTop: number) => PathFrames,
  { fill = false }: { fill?: boolean } = {},
): Run {
  const scrollTop = panel.scrollTop;
  panel.style.overflow = "clip";
  panel.style.transformOrigin = "0 0";
  const content = contentOf(panel);
  if (content) content.style.transformOrigin = "0 0";
  const keyframes = frames(scrollTop);
  const timing: KeyframeAnimationOptions = {
    duration: MORPH_MS,
    easing: EASING,
    ...(fill && { fill: "forwards" }),
  };
  const run: Run = {
    panel: panel.animate(keyframes.panel, timing),
    content: content?.animate(keyframes.content, timing) ?? null,
    corners:
      keyframes.corners.length > 0
        ? panel.animate(keyframes.corners, timing)
        : null,
    scrollTop,
  };
  runs.set(panel, run);
  const release = () => {
    if (runs.get(panel) !== run) return;
    runs.delete(panel);
    panel.style.overflow = "";
    panel.scrollTop = scrollTop;
  };
  run.panel.finished.then(() => {
    if (!fill) release();
  }, release);
  return run;
}

/** The animations of a run, which move together. */
function runAnimations(run: Run): Animation[] {
  return [run.panel, run.content, run.corners].filter(
    (animation): animation is Animation => animation !== null,
  );
}

/** Sets new keyframes on all animations of a run, at the same time. */
function setRunFrames(run: Run, frames: PathFrames) {
  (run.panel.effect as KeyframeEffect | null)?.setKeyframes(frames.panel);
  (run.content?.effect as KeyframeEffect | null)?.setKeyframes(frames.content);
  (run.corners?.effect as KeyframeEffect | null)?.setKeyframes(frames.corners);
}

/**
 * Ends a morph that still runs (or is held at its end). Thus, the panel is
 * measured where it is laid out, not at a point during the animation. A close
 * during the open is only one press.
 */
export function settle(panel: HTMLElement) {
  following.get(panel)?.();
  const run = runs.get(panel);
  if (run) {
    // At once, not when the cancel settles: a new run reads the scroll next,
    // and a clipped panel has none.
    runs.delete(panel);
    panel.style.overflow = "";
    panel.scrollTop = run.scrollTop;
    for (const animation of runAnimations(run)) animation.cancel();
  }
  for (const animation of panel.getAnimations()) animation.cancel();
}

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
  const path = { start: from, end: to, layout: to, startAt: 0 };
  const run = startRun(panel, (scrollTop) =>
    pathFrames(path, radius, scrollTop, opacity),
  );
  keepAimed(panel, run, path, {
    phone,
    // The fade belongs to the grow. A later size change is opaque.
    frames: (next, scrollTop, grow) =>
      pathFrames(next, radius, scrollTop, grow ? opacity : undefined),
  });
  if (ready) holdUntil(panel, run, ready, onStart);
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
  panel: HTMLElement,
  run: Run,
  ready: Promise<void>,
  onStart: (() => void) | undefined,
) {
  for (const animation of runAnimations(run)) animation.pause();
  // Transparent while it waits, over the source, which stays. The two only
  // change places when the grow moves. When the panel covered the card during
  // the wait, the card changed its look at the click, before anything moved.
  // `opacity`, not `visibility`: the editor takes focus while it waits.
  panel.style.opacity = "0";
  let go = () => {
    go = () => {};
    clearTimeout(timer);
    panel.style.opacity = "";
    // Cancelled while it waited (a close): it stays cancelled.
    if (run.panel.playState !== "paused") return;
    for (const animation of runAnimations(run)) animation.play();
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
  grow: Run,
  first: MorphPath,
  {
    phone,
    frames,
  }: {
    phone: boolean;
    frames: (path: MorphPath, scrollTop: number, grow: boolean) => PathFrames;
  },
) {
  if (typeof ResizeObserver !== "function") return;
  let run = grow;
  let path = first;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new ResizeObserver(() => {
    // The size of the layout box. A transform does not change it.
    const moved =
      Math.abs(panel.offsetWidth - path.layout.width) >= 1 ||
      Math.abs(panel.offsetHeight - path.layout.height) >= 1;
    const effect = run.panel.effect;
    if (!moved || !(effect instanceof KeyframeEffect)) return;
    if (run.panel.playState !== "finished") {
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
      setRunFrames(run, frames(path, run.scrollTop, run === grow));
      return;
    }
    const layout = panel.getBoundingClientRect();
    if (phone) {
      path = { start: layout, end: layout, layout, startAt: 0 };
      return;
    }
    path = { start: path.layout, end: layout, layout, startAt: 0 };
    const next = path;
    run = startRun(panel, (scrollTop) => frames(next, scrollTop, false));
  });
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    if (following.get(panel) === stop) following.delete(panel);
  };
  following.set(panel, stop);
  observer.observe(panel);
  grow.panel.finished.then(
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
  const radius = noteRadius();
  const path = { start: from, end: to, layout: from, startAt: 0 };
  const run = startRun(
    panel,
    (scrollTop) => pathFrames(path, radius, scrollTop),
    { fill: true },
  );
  if (fade) {
    panel.animate(
      [{ opacity: 1 }, { opacity: 1, offset: 1 - FADE_SHARE }, { opacity: 0 }],
      { duration: MORPH_MS, fill: "forwards" },
    );
  }
  return run.panel.finished.then(
    () => {},
    // Cancelled: opened again during the close, which stops the panel where it
    // is.
    () => {},
  );
}
