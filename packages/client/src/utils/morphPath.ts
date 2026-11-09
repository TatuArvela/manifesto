/**
 * The path of a morph (`utils/morph.ts`): the straight line along which it
 * draws a panel, and the keyframes that draw it there. Only geometry, with no
 * element. Thus, the Node suite can test it.
 */

import { type ShadowPath, shadowAt } from "./morphShadow.ts";

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

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
   * For the edge of the panel: its corners, when a note has round corners, and
   * its shadow (`utils/morphShadow.ts`). Its own animation: an animation runs
   * on the compositor only when all of its properties can, and `border-radius`
   * and `box-shadow` cannot.
   */
  edge: Keyframe | null;
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
 * the panel is divided by its scale on each axis. `shadow` does the same for
 * its shadow, at `progress` from the shadow of the card to the shadow of the
 * panel. `scrollTop` keeps a panel that was scrolled (a close of a long note)
 * where it was, because the clip resets its scroll.
 */
export function morphFrames(
  rect: RectLike,
  to: RectLike,
  radius: number,
  scrollTop: number,
  shadow?: { path: ShadowPath; progress: number } | undefined,
): MorphFrame {
  const scaleX = Math.max(to.width > 0 ? rect.width / to.width : 1, 0.001);
  const scaleY = Math.max(to.height > 0 ? rect.height / to.height : 1, 0.001);
  const boxShadow =
    shadow && shadowAt(shadow.path, shadow.progress, scaleX, scaleY);
  const edge: Keyframe = {
    ...(radius > 0 && {
      borderRadius: `${radius / scaleX}px / ${radius / scaleY}px`,
    }),
    ...(boxShadow && { boxShadow }),
  };
  return {
    panel: {
      transform: `translate(${rect.left - to.left}px, ${rect.top - to.top}px) scale(${scaleX}, ${scaleY})`,
    },
    content: {
      transform: `scale(${1 / scaleX}, ${1 / scaleY}) translate(0px, ${-scrollTop}px)`,
    },
    edge: Object.keys(edge).length > 0 ? edge : null,
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

/** The keyframes of a path, for the panel, its content and its edge. */
export interface PathFrames {
  panel: Keyframe[];
  content: Keyframe[];
  /** Empty when a note has square corners and no shadow. */
  edge: Keyframe[];
}

/**
 * The keyframes of `path`, as points on its line. Before `startAt`, the
 * keyframes stay at the start of the line. The animation never goes back
 * there. The shadow changes with the progress of the run, as the opacity does.
 */
export function pathFrames(
  path: MorphPath,
  radius: number,
  scrollTop: number,
  opacity?: ((offset: number) => number) | undefined,
  shadow?: ShadowPath | undefined,
): PathFrames {
  const { start, end, layout, startAt } = path;
  const frames: PathFrames = { panel: [], content: [], edge: [] };
  const at = (offset: number, rect: RectLike) => {
    const frame = morphFrames(
      rect,
      layout,
      radius,
      scrollTop,
      shadow && { path: shadow, progress: offset },
    );
    frames.panel.push({
      ...frame.panel,
      ...(opacity && { opacity: opacity(offset) }),
      offset,
    });
    frames.content.push({ ...frame.content, offset });
    if (frame.edge) frames.edge.push({ ...frame.edge, offset });
  };
  if (startAt > 0) at(0, start);
  for (const along of pathPoints(path)) {
    at(startAt + (1 - startAt) * along, shownRect(start, end, along));
  }
  return frames;
}

/** The rectangle of `path` at `progress` of its run. */
export function pointOn(path: MorphPath, progress: number): RectLike {
  const along =
    path.startAt >= 1 ? 1 : (progress - path.startAt) / (1 - path.startAt);
  return shownRect(path.start, path.end, Math.max(0, along));
}
