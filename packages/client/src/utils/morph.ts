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
 *
 * The geometry of the path is in `utils/morphPath.ts`.
 *
 * A card gives a copy of itself (`utils/morphStandIn.ts`). The window shows
 * the card for the part of the way near the card, and the editor for the rest.
 */

import {
  type MorphPath,
  type PathFrames,
  pathFrames,
  pointOn,
  type RectLike,
} from "./morphPath.ts";
import { parseShadow, type ShadowPath } from "./morphShadow.ts";
import { SWITCH_AT, standInFor, switchFrames } from "./morphStandIn.ts";
import { isPhoneLayout } from "./phoneSheets.ts";

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
  edge: Animation | null;
  /** The inverse scale of the face of the copy of the card, if there is one. */
  face: Animation | null;
  /** The changes between the card and the editor (`switchFrames`). */
  switches: Animation[];
  /** The copy of the card in the window, which the run removes. */
  standIn: HTMLElement | null;
  /**
   * The progress at which the window shows the editor and not the card, for a
   * close that starts during the grow. Null with no copy.
   */
  switchAt: number | null;
  /** The scroll of the panel before the clip reset it. */
  scrollTop: number;
  /** The line along which it draws the panel now. */
  path: MorphPath;
}

/** The copy of a card that a run shows in its window, and how. */
interface StandInRun {
  card: HTMLElement;
  /** A grow, which starts with the card. */
  cardFirst: boolean;
  /** The progress at which the two change places. */
  at: number;
}

/** The runs of each panel, which `settle` cancels. */
const runs = new WeakMap<HTMLElement, Run>();
/** The stop of the watch of `keepAimed` on each panel that has one. */
const following = new WeakMap<HTMLElement, () => void>();
/** The end of the wait of each grow that still waits (`holdUntil`). */
const holds = new WeakMap<HTMLElement, () => void>();

/**
 * Starts a run along `path`. The panel clips its content while the run lasts,
 * and gets its overflow and its scroll back when the run ends. A run that keeps
 * its end (`fill`, a close) keeps the clip and the copy of the card: the panel
 * goes after it.
 */
function startRun(
  panel: HTMLElement,
  path: MorphPath,
  frames: (scrollTop: number) => PathFrames,
  {
    fill = false,
    standIn: copy,
  }: { fill?: boolean; standIn?: StandInRun | undefined } = {},
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
  const standIn = copy ? standInFor(copy.card) : null;
  if (standIn) panel.append(standIn.element);
  const switches = copy ? switchFrames(copy.cardFirst, copy.at) : null;
  const run: Run = {
    panel: panel.animate(keyframes.panel, timing),
    content: content?.animate(keyframes.content, timing) ?? null,
    edge:
      keyframes.edge.length > 0 ? panel.animate(keyframes.edge, timing) : null,
    // The face is never scrolled: the content of a card has no scroll.
    face: standIn?.face.animate(frames(0).content, timing) ?? null,
    switches:
      standIn && switches
        ? [
            standIn.element.animate(switches.standIn, timing),
            ...(content ? [content.animate(switches.content, timing)] : []),
          ]
        : [],
    standIn: standIn?.element ?? null,
    switchAt: copy?.cardFirst ? copy.at : null,
    scrollTop,
    path,
  };
  runs.set(panel, run);
  const release = () => {
    if (runs.get(panel) !== run) return;
    runs.delete(panel);
    run.standIn?.remove();
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
  return [run.panel, run.content, run.edge, run.face, ...run.switches].filter(
    (animation): animation is Animation => animation !== null,
  );
}

/** Sets new keyframes on all animations of a run, at the same time. */
function setRunFrames(run: Run, frames: PathFrames) {
  (run.panel.effect as KeyframeEffect | null)?.setKeyframes(frames.panel);
  (run.content?.effect as KeyframeEffect | null)?.setKeyframes(frames.content);
  (run.edge?.effect as KeyframeEffect | null)?.setKeyframes(frames.edge);
  // Only a grow is aimed again, and a grow starts with no scroll. Thus, the
  // frames of the content are also those of the face.
  (run.face?.effect as KeyframeEffect | null)?.setKeyframes(frames.content);
}

/**
 * Ends a morph that still runs (or is held at its end). Thus, the panel is
 * measured where it is laid out, not at a point during the animation. A close
 * during the open is only one press.
 */
export function settle(panel: HTMLElement) {
  following.get(panel)?.();
  holds.get(panel)?.();
  const run = runs.get(panel);
  if (run) {
    // At once, not when the cancel settles: a new run reads the scroll next,
    // and a clipped panel has none.
    runs.delete(panel);
    run.standIn?.remove();
    panel.style.overflow = "";
    panel.scrollTop = run.scrollTop;
    for (const animation of runAnimations(run)) animation.cancel();
  }
  for (const animation of panel.getAnimations()) animation.cancel();
}

/**
 * Where a run draws `panel` now, and if its window shows the card, or null when
 * no run moves it. The progress is after the curve, which is what the keyframes
 * interpolate.
 */
function drawnNow(
  panel: HTMLElement,
): { rect: RectLike; showsCard: boolean } | null {
  const run = runs.get(panel);
  const effect = run?.panel.effect;
  if (!run || !(effect instanceof KeyframeEffect)) return null;
  const progress = effect.getComputedTiming().progress;
  if (progress === null || progress === undefined) return null;
  return {
    rect: pointOn(run.path, progress),
    showsCard: run.switchAt !== null && progress < run.switchAt,
  };
}

/** The shadow that the panel has in its layout, with no run. */
function ownShadow(panel: HTMLElement) {
  return parseShadow(getComputedStyle(panel).boxShadow);
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
 *
 * `shadow` is the `box-shadow` of the source. The panel starts with it, and
 * has its own shadow at the end. With no `shadow`, the panel keeps its own.
 */
export function morphIn(
  panel: HTMLElement,
  from: RectLike,
  {
    opaque = false,
    ready,
    onStart,
    shadow,
    standIn,
  }: {
    opaque?: boolean;
    ready?: Promise<void> | undefined;
    shadow?: string | undefined;
    /**
     * The card, which the window shows until `SWITCH_AT`
     * (`utils/morphStandIn.ts`).
     */
    standIn?: HTMLElement | null | undefined;
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
  const own = ownShadow(panel);
  const kept: ShadowPath = { from: own, to: own };
  const shadows: ShadowPath = shadow
    ? { from: parseShadow(shadow), to: own }
    : kept;
  const to = panel.getBoundingClientRect();
  const path = { start: from, end: to, layout: to, startAt: 0 };
  const run = startRun(
    panel,
    path,
    (scrollTop) => pathFrames(path, radius, scrollTop, opacity, shadows),
    {
      standIn: standIn
        ? { card: standIn, cardFirst: true, at: SWITCH_AT }
        : undefined,
    },
  );
  keepAimed(panel, run, path, {
    phone,
    // The fade and the change of shadow belong to the grow. A later size
    // change is opaque, and keeps the shadow of the panel.
    frames: (next, scrollTop, grow) =>
      grow
        ? pathFrames(next, radius, scrollTop, opacity, shadows)
        : pathFrames(next, radius, scrollTop, undefined, kept),
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
  // The wait ends: the grow goes, or `settle` cancels it (a close, or an open
  // again). A cancelled grow never goes later.
  const end = () => {
    go = () => {};
    clearTimeout(timer);
    holds.delete(panel);
    panel.style.opacity = "";
  };
  let go = () => {
    end();
    for (const animation of runAnimations(run)) animation.play();
    onStart?.();
  };
  holds.set(panel, end);
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
      const shown = pointOn(path, progress);
      effect.setKeyframes([]);
      const layout = panel.getBoundingClientRect();
      path = { start: shown, end: layout, layout, startAt: progress };
      run.path = path;
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
    run = startRun(panel, next, (scrollTop) => frames(next, scrollTop, false));
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
 * from its target. `shadow` is the `box-shadow` of the target, which the panel
 * has when it lands.
 *
 * The shrink starts where the panel is drawn now. A close during the grow
 * started from the layout of the panel: the full editor showed for a frame,
 * and then shrank. A grow that still waits for its content (`holdUntil`) never
 * showed, and its source is still there. Thus, it ends at once, with nothing
 * to play.
 */
export function morphOut(
  panel: HTMLElement,
  to: RectLike,
  {
    fade = true,
    shadow,
    standIn,
  }: {
    fade?: boolean;
    shadow?: string | undefined;
    /**
     * The card, which the window shows from `SWITCH_AT` to the end. From the
     * start, when a grow closes before it showed the editor.
     */
    standIn?: HTMLElement | null | undefined;
  } = {},
): Promise<void> {
  const waiting = holds.has(panel);
  const drawn = drawnNow(panel);
  settle(panel);
  if (waiting) {
    // Transparent until the caller removes it, as it was during the wait.
    panel.style.opacity = "0";
    return Promise.resolve();
  }
  const layout = panel.getBoundingClientRect();
  const radius = noteRadius();
  const own = ownShadow(panel);
  const shadows: ShadowPath = shadow
    ? { from: own, to: parseShadow(shadow) }
    : { from: own, to: own };
  const path = { start: drawn?.rect ?? layout, end: to, layout, startAt: 0 };
  const run = startRun(
    panel,
    path,
    (scrollTop) => pathFrames(path, radius, scrollTop, undefined, shadows),
    {
      fill: true,
      standIn: standIn
        ? {
            card: standIn,
            cardFirst: false,
            at: drawn?.showsCard ? 0 : SWITCH_AT,
          }
        : undefined,
    },
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
