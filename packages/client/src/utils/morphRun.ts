/**
 * One run of a morph (`utils/morph.ts`): the animations of the panel, of its
 * content, of its corners, of the copy of the card and of the plates of its
 * shadow, with one timing. The panel decides the state and the progress.
 *
 * Each animation of a morph belongs to a run. Thus, `cancelRun` stops a morph
 * with no call to `getAnimations`, which makes the browser calculate the style
 * of the page.
 */

import {
  type CornerPath,
  type MorphPath,
  type PathFrames,
  pathStops,
  pointOn,
  type RectLike,
} from "./morphPath.ts";
import {
  type Plate,
  plateFrames,
  platesFor,
  type ShadowPath,
} from "./morphPlates.ts";
import { standInFor, switchFrames } from "./morphStandIn.ts";

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

/** The content of a panel, which takes the inverse scale. */
function contentOf(panel: HTMLElement): HTMLElement | null {
  const first = panel.firstElementChild;
  return first instanceof HTMLElement ? first : null;
}

/**
 * The width of a classic scrollbar of a panel, which the clip of a run takes
 * away. 0 for an overlay scrollbar, and for a panel with no scroll. Under 2px
 * is the rounding of the two widths, not a scrollbar.
 */
function scrollbarOf(panel: HTMLElement, style: CSSStyleDeclaration): number {
  const borders =
    (Number.parseFloat(style.borderLeftWidth) || 0) +
    (Number.parseFloat(style.borderRightWidth) || 0);
  const width = panel.offsetWidth - panel.clientWidth - borders;
  return width >= 2 ? width : 0;
}

/**
 * What a run draws at the edge of the window: the shadow and the radius of the
 * corners at each end.
 */
export interface Edge {
  shadows: ShadowPath;
  corners: CornerPath;
}

/**
 * One run of a morph: the animation of the panel, and the ones of its content,
 * its corners and its shadows, with the same timing. The panel decides the
 * state and the progress.
 */
export interface Run {
  panel: Animation;
  content: Animation | null;
  /** The clip of round corners. */
  corners: Animation | null;
  /** The inverse scale of the face of the copy of the card, if there is one. */
  face: Animation | null;
  /** The changes between the card and the editor (`switchFrames`). */
  switches: Animation[];
  /** The plates that draw the shadow, which the run removes. */
  plates: { plate: Plate; animation: Animation }[];
  /** The copy of the card in the window, which the run removes. */
  standIn: HTMLElement | null;
  /**
   * The progress at which the window shows the editor and not the card, for a
   * close that starts during the grow. Null with no copy.
   */
  switchAt: number | null;
  /** The scroll of the panel before the clip reset it. */
  scrollTop: number;
  /** The own inline shadow of the panel, which the run turns off and gives back. */
  shadow: string | null;
  /**
   * The own inline end padding of a panel with a classic scrollbar, which the
   * run makes wider and gives back. Null with no such scrollbar.
   */
  padding: string | null;
  /** The edge of a grow, from which a close during it starts. Null for other runs. */
  growEdge: Edge | null;
  /** The line along which it draws the panel now. */
  path: MorphPath;
}

/** The copy of a card that a run shows in its window, and how. */
export interface StandInRun {
  card: HTMLElement;
  /** A grow, which starts with the card. */
  cardFirst: boolean;
  /** The progress at which the two change places. */
  at: number;
}

/** The runs of each panel, which `cancelRun` cancels. */
const runs = new WeakMap<HTMLElement, Run>();

/**
 * Starts a run along `path`. The panel clips its content while the run lasts,
 * and gets its overflow, its shadow and its scroll back when the run ends. A
 * run that keeps its end (`fill`, a close) keeps the clip, the copy of the card
 * and the plates: the panel goes after it.
 *
 * It reads all that it needs before it writes. The caller has laid the page out
 * to measure the panel. Thus, the run makes the browser lay it out no second
 * time.
 */
export function startRun(
  panel: HTMLElement,
  path: MorphPath,
  frames: (path: MorphPath, scrollTop: number) => PathFrames,
  {
    fill = false,
    standIn: copy,
    edge,
    grows = false,
    fade,
  }: {
    fill?: boolean;
    standIn?: StandInRun | undefined;
    /** The shadows and the corners. Not drawn by a size change after a grow. */
    edge?: Edge | undefined;
    /** A grow, whose edge a close during it starts from. */
    grows?: boolean;
    fade?: ((offset: number) => number) | undefined;
  } = {},
): Run {
  const scrollTop = panel.scrollTop;
  const style = getComputedStyle(panel);
  const scrollbar = scrollbarOf(panel, style);
  const endPadding = Number.parseFloat(style.paddingInlineEnd) || 0;
  const standIn = copy ? standInFor(copy.card) : null;
  panel.style.overflow = "clip";
  // The clip takes a classic scrollbar away. Its width goes to the end padding
  // (the side of the scrollbar, also in a right-to-left text) while the run
  // lasts. If not, the content became wider by that width, and its text
  // wrapped again at the start of the run and at its end.
  const padding = scrollbar > 0 ? panel.style.paddingInlineEnd : null;
  if (scrollbar > 0) {
    panel.style.paddingInlineEnd = `${endPadding + scrollbar}px`;
  }
  panel.style.transformOrigin = "0 0";
  const content = contentOf(panel);
  if (content) content.style.transformOrigin = "0 0";
  const keyframes = frames(path, scrollTop);
  const timing: KeyframeAnimationOptions = {
    duration: MORPH_MS,
    easing: EASING,
    ...(fill && { fill: "forwards" }),
  };
  if (standIn) panel.append(standIn.element);
  const plates = edge
    ? platesFor(panel, path, edge.shadows, edge.corners, fade)
    : [];
  // The plates draw the shadow now. The own shadow of the panel would be cut by
  // the clip of round corners, and would be drawn two times.
  const shadow = edge ? panel.style.boxShadow : null;
  if (edge) panel.style.boxShadow = "none";
  const stops = pathStops(path);
  const switches = copy ? switchFrames(copy.cardFirst, copy.at) : null;
  const run: Run = {
    panel: panel.animate(keyframes.panel, timing),
    content: content?.animate(keyframes.content, timing) ?? null,
    corners:
      keyframes.corners.length > 0
        ? panel.animate(keyframes.corners, timing)
        : null,
    // The face is never scrolled: the content of a card has no scroll.
    face:
      standIn?.face.animate(
        scrollTop === 0 ? keyframes.content : frames(path, 0).content,
        timing,
      ) ?? null,
    switches:
      standIn && switches
        ? [
            standIn.element.animate(switches.standIn, timing),
            ...(content ? [content.animate(switches.content, timing)] : []),
          ]
        : [],
    plates: plates.map((plate) => ({
      plate,
      animation: plate.element.animate(plateFrames(plate, stops), timing),
    })),
    standIn: standIn?.element ?? null,
    switchAt: copy?.cardFirst ? copy.at : null,
    scrollTop,
    shadow,
    padding,
    growEdge: grows ? (edge ?? null) : null,
    path,
  };
  runs.set(panel, run);
  const release = () => {
    if (runs.get(panel) !== run) return;
    runs.delete(panel);
    clearRun(panel, run);
  };
  run.panel.finished.then(() => {
    if (!fill) release();
  }, release);
  return run;
}

/** Removes what a run added to the page, and gives the panel back its own. */
function clearRun(panel: HTMLElement, run: Run) {
  run.standIn?.remove();
  for (const { plate } of run.plates) plate.element.remove();
  panel.style.overflow = "";
  if (run.padding !== null) panel.style.paddingInlineEnd = run.padding;
  if (run.shadow !== null) panel.style.boxShadow = run.shadow;
  panel.scrollTop = run.scrollTop;
}

/** The animations of a run, which move together. */
function runAnimations(run: Run): Animation[] {
  return [
    run.panel,
    run.content,
    run.corners,
    run.face,
    ...run.switches,
    ...run.plates.map(({ animation }) => animation),
  ].filter((animation): animation is Animation => animation !== null);
}

/** Sets new keyframes on all animations of a run, at the same time. */
export function setRunFrames(run: Run, frames: PathFrames) {
  (run.panel.effect as KeyframeEffect | null)?.setKeyframes(frames.panel);
  (run.content?.effect as KeyframeEffect | null)?.setKeyframes(frames.content);
  (run.corners?.effect as KeyframeEffect | null)?.setKeyframes(frames.corners);
  // Only a grow is aimed again, and a grow starts with no scroll. Thus, the
  // frames of the content are also those of the face.
  (run.face?.effect as KeyframeEffect | null)?.setKeyframes(frames.content);
  const stops = pathStops(run.path);
  for (const { plate, animation } of run.plates) {
    (animation.effect as KeyframeEffect | null)?.setKeyframes(
      plateFrames(plate, stops),
    );
  }
}

/**
 * What a grow draws at the edge of the window at one point: the radius of the
 * corners, and the part of the shadow that is the own shadow of the panel.
 */
export interface DrawnEdge {
  radius: number;
  ownShare: number;
}

/**
 * Where a run draws `panel` now, if its window shows the card, and the edge
 * that a grow draws there. Null when no run moves it. The progress is after
 * the curve, which is what the keyframes interpolate.
 */
export function drawnNow(
  panel: HTMLElement,
): { rect: RectLike; showsCard: boolean; edge: DrawnEdge | null } | null {
  const run = runs.get(panel);
  const effect = run?.panel.effect;
  if (!run || !(effect instanceof KeyframeEffect)) return null;
  const progress = effect.getComputedTiming().progress;
  if (progress === null || progress === undefined) return null;
  const grown = run.growEdge;
  return {
    rect: pointOn(run.path, progress),
    showsCard: run.switchAt !== null && progress < run.switchAt,
    // As `pathFrames` and `platesFor` draw them, by the progress.
    edge: grown && {
      radius:
        grown.corners.from + (grown.corners.to - grown.corners.from) * progress,
      ownShare: grown.shadows.from === grown.shadows.to ? 1 : progress,
    },
  };
}

/**
 * Cancels the run of `panel`, if it has one, and removes what the run added.
 * At once, not when the cancel settles: a new run reads the scroll next, and a
 * clipped panel has none.
 */
export function cancelRun(panel: HTMLElement) {
  const run = runs.get(panel);
  if (!run) return;
  runs.delete(panel);
  clearRun(panel, run);
  for (const animation of runAnimations(run)) animation.cancel();
}
