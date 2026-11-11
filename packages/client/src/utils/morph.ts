/**
 * The open and close of the editor of a note, drawn as the note itself that
 * grows into the editor and shrinks back onto its card. The editor panel is
 * laid out where it belongs, and drawn over the rectangle from which it came.
 * Thus, the layout of the editor inside never changes during the animation.
 *
 * Nothing of a morph needs the main thread in Chromium: the window moves with
 * `transform`, its shadow is on plates that move and fade
 * (`utils/morphPlates.ts`), and round corners are a `clip-path`. The main
 * thread is busy while a note opens: the editor builds, the shared document
 * arrives, images decode. A part that needed it stopped at each long frame,
 * and lost its place under the parts that moved on. Other browsers run the
 * clip of round corners on the main thread. Square corners (the default) need
 * no clip.
 *
 * It is a container transform (`morphFrames`). The panel moves and scales to
 * the rectangle, and clips its content to its own box (`overflow: clip` while
 * it runs). Its first child, the content (`.note-sheet-content`), has the
 * inverse scale. Thus, the window grows and slides, and the text in it keeps
 * its size the whole way.
 *
 * The geometry of the path is in `utils/morphPath.ts`, and one run with its
 * animations in `utils/morphRun.ts`.
 *
 * A card gives a copy of itself (`utils/morphStandIn.ts`). The window shows
 * the card for the part of the way near the card, and the editor for the rest.
 */

import {
  type CornerPath,
  type MorphPath,
  type PathFrames,
  pathFrames,
  pointOn,
  type RectLike,
} from "./morphPath.ts";
import { movePlate } from "./morphPlates.ts";
import {
  cancelRun,
  drawnNow,
  type Edge,
  type Run,
  setRunFrames,
  startRun,
} from "./morphRun.ts";
import { SWITCH_AT } from "./morphStandIn.ts";
import { isPhoneLayout } from "./phoneSheets.ts";

export { MORPH_MS } from "./morphRun.ts";

/** The part of the run during which a panel that is not opaque fades in. */
const FADE_SHARE = 0.3;
/** A run that does not draw the corners (a size change after the grow). */
const NO_CORNERS: CornerPath = { from: 0, to: 0 };
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

/** The corner radius of a note in pixels, which a card has. */
function noteRadius(): number {
  const root = getComputedStyle(document.documentElement);
  const value = root.getPropertyValue("--note-radius").trim();
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return 0;
  return value.endsWith("rem")
    ? number * Number.parseFloat(root.fontSize)
    : number;
}

/** The own shadow and corner radius of a panel, as laid out with no run. */
function ownEdge(panel: HTMLElement): { shadow: string; radius: number } {
  const style = getComputedStyle(panel);
  return {
    shadow: style.boxShadow,
    radius: Number.parseFloat(style.borderTopLeftRadius) || 0,
  };
}

/** The stop of the watch of `keepAimed` on each panel that has one. */
const following = new WeakMap<HTMLElement, () => void>();
/** The end of the wait of each grow that still waits (`holdUntil`). */
const holds = new WeakMap<HTMLElement, () => void>();

/**
 * Ends a morph that still runs (or is held at its end). Thus, the panel is
 * measured where it is laid out, not at a point during the animation. A close
 * during the open is only one press.
 *
 * Each animation of a morph belongs to a run. Thus, it cancels those, and does
 * not ask the panel for its animations: `getAnimations` makes the browser
 * calculate the style of the page. For a sheet that just mounted, that was
 * the full sheet, in the task of the click (5 ms).
 */
export function settle(panel: HTMLElement) {
  following.get(panel)?.();
  holds.get(panel)?.();
  cancelRun(panel);
}

/**
 * Ends the morph of a panel that closes in place, with no shrink (its card is
 * out of sight, or animations are off), or that shrinks next. Returns false
 * for a grow that still waited for its content (`holdUntil`): the panel never
 * showed, and stays transparent until the caller removes it. Its source is
 * still there.
 */
export function stopMorph(panel: HTMLElement): boolean {
  const waiting = holds.has(panel);
  settle(panel);
  if (waiting) panel.style.opacity = "0";
  return !waiting;
}

/**
 * How long after a grow the panel still follows its content. A size change in
 * that time animates from the old size. Images, link previews and the shared
 * document of a note on a server can arrive after the grow, and the centered
 * panel jumped at each one.
 */
export const MORPH_FOLLOW_MS = 1000;

/** The events by which the reader changes the panel or its scroll. */
const READER_INPUT = [
  "keydown",
  "beforeinput",
  "paste",
  "drop",
  "pointerdown",
  "wheel",
] as const;

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
  const go = () => {
    grow(panel, from, { opaque, shadow, standIn });
    onStart?.();
  };
  if (ready) holdUntil(panel, ready, go);
  else go();
}

/**
 * Measures the panel and starts its grow. Only now, when its content is there:
 * one measure of the full panel, and one layout of the page for it.
 */
function grow(
  panel: HTMLElement,
  from: RectLike,
  {
    opaque,
    shadow,
    standIn,
  }: {
    opaque: boolean;
    shadow: string | undefined;
    standIn: HTMLElement | null | undefined;
  },
) {
  const phone = isPhoneLayout();
  const radius = noteRadius();
  const own = ownEdge(panel);
  const to = panel.getBoundingClientRect();
  const opacity = opaque
    ? undefined
    : (offset: number) => Math.min(1, offset / FADE_SHARE);
  const edge: Edge = {
    shadows: { from: shadow ?? own.shadow, to: own.shadow },
    corners: { from: radius, to: own.radius },
  };
  const path = { start: from, end: to, layout: to, startAt: 0 };
  const run = startRun(
    panel,
    path,
    (next, scrollTop) => pathFrames(next, edge.corners, scrollTop, opacity),
    {
      standIn: standIn
        ? { card: standIn, cardFirst: true, at: SWITCH_AT }
        : undefined,
      edge,
      grows: true,
      fade: opacity,
    },
  );
  keepAimed(panel, run, path, {
    phone,
    // The fade, the corners and the change of shadow belong to the grow. A
    // later size change is opaque, and keeps the shadow of the panel.
    frames: (next, scrollTop, isGrow) =>
      isGrow
        ? pathFrames(next, edge.corners, scrollTop, opacity)
        : pathFrames(next, NO_CORNERS, scrollTop),
  });
}

/**
 * The longest time that a grow waits for its content (`ready`). An editor that
 * takes longer grows from what is there, and `keepAimed` follows it.
 */
export const MORPH_READY_WAIT_MS = 150;

/**
 * Holds a grow until its content is there, and then starts it (`go`). Milkdown
 * builds its view after the panel mounts, in microtasks. Usually that is
 * before the first paint, and the grow starts in the same task. A grow that
 * started at once went to the empty panel first, and then to the full one.
 * When the empty panel was centered lower than the card, the grow went down,
 * and then back up. A grow that was built at once and held measured the panel
 * two times, and laid the page out for each measure.
 */
function holdUntil(panel: HTMLElement, ready: Promise<void>, go: () => void) {
  // Transparent while it waits, over the source, which stays. The two only
  // change places when the grow moves. When the panel covered the card during
  // the wait, the card changed its look at the click, before anything moved.
  // `opacity`, not `visibility`: the editor takes focus while it waits.
  panel.style.opacity = "0";
  let waiting = true;
  // The wait ends: the grow goes, or `settle` cancels it (a close, or an open
  // again). A cancelled grow never goes later.
  const end = () => {
    waiting = false;
    clearTimeout(timer);
    holds.delete(panel);
  };
  const start = () => {
    if (!waiting) return;
    end();
    go();
    panel.style.opacity = "";
  };
  holds.set(panel, () => {
    end();
    panel.style.opacity = "";
  });
  const timer = setTimeout(start, MORPH_READY_WAIT_MS);
  void ready.then(start, start);
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
 * done. The plate of the panel moves to the new layout. Thus, the shadow lands
 * at the size of the own shadow of the panel. After a run, a new run goes from
 * the old layout to the new one. Not on a phone, where the sheet is in the
 * flow of the page: a taller sheet does not move what is on the screen.
 *
 * A `ResizeObserver` reports after layout and before paint. Thus, the frame
 * that shows the new size already has the new keyframes. The panel is measured
 * with no keyframes, because its box with the transform applied is not its
 * layout. `settle` stops the watch, so that a close is never aimed again.
 *
 * A size change that the reader makes is not followed after the grow. When the
 * reader types, pastes, presses or scrolls in the panel, the watch stops (at
 * the end of the grow, if it still runs). Each new line started a run that
 * clipped the panel. Thus, the caret could not scroll into view, and the end of
 * the run gave the panel back its old scroll.
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
    frames: (path: MorphPath, scrollTop: number, isGrow: boolean) => PathFrames;
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
      for (const { plate } of run.plates) movePlate(plate, layout);
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
    run = startRun(panel, next, (line, scrollTop) =>
      frames(line, scrollTop, false),
    );
  });
  let byReader = false;
  const onReader = () => {
    if (grow.panel.playState === "finished") stop();
    else byReader = true;
  };
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    for (const type of READER_INPUT) {
      panel.removeEventListener(type, onReader, true);
    }
    if (following.get(panel) === stop) following.delete(panel);
  };
  following.set(panel, stop);
  observer.observe(panel);
  for (const type of READER_INPUT) {
    panel.addEventListener(type, onReader, { capture: true, passive: true });
  }
  grow.panel.finished.then(
    () => {
      if (byReader) stop();
      else timer = setTimeout(stop, MORPH_FOLLOW_MS);
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
 * The panel lands exactly on the card, and the card shows when the panel goes.
 * `shadow` is the `box-shadow` of the target, which the panel has when it
 * lands.
 *
 * The shrink starts where the panel is drawn now, with the corners and the
 * shadow drawn there. A close during the grow started from the layout of the
 * panel: the full editor showed for a frame, and then shrank. From the own
 * corners and shadow of the panel, those jumped at the press. A grow that
 * still waits for its content (`holdUntil`) never showed, and its source is
 * still there. Thus, it ends at once, with nothing to play.
 */
export function morphOut(
  panel: HTMLElement,
  to: RectLike,
  {
    shadow,
    standIn,
  }: {
    shadow?: string | undefined;
    /**
     * The card, which the window shows from `SWITCH_AT` to the end. From the
     * start, when a grow closes before it showed the editor.
     */
    standIn?: HTMLElement | null | undefined;
  } = {},
): Promise<void> {
  const drawn = drawnNow(panel);
  if (!stopMorph(panel)) return Promise.resolve();
  const layout = panel.getBoundingClientRect();
  const radius = noteRadius();
  const own = ownEdge(panel);
  const edge: Edge = {
    shadows: {
      from: own.shadow,
      to: shadow ?? own.shadow,
      // The part of the shadow of the card that the grow drew.
      startMix: drawn?.edge ? 1 - drawn.edge.ownShare : 0,
    },
    corners: { from: drawn?.edge?.radius ?? own.radius, to: radius },
  };
  const path = { start: drawn?.rect ?? layout, end: to, layout, startAt: 0 };
  const run = startRun(
    panel,
    path,
    (next, scrollTop) => pathFrames(next, edge.corners, scrollTop),
    {
      fill: true,
      standIn: standIn
        ? {
            card: standIn,
            cardFirst: false,
            at: drawn?.showsCard ? 0 : SWITCH_AT,
          }
        : undefined,
      edge,
    },
  );
  return run.panel.finished.then(
    () => {},
    // Cancelled: opened again during the close, which stops the panel where it
    // is.
    () => {},
  );
}
