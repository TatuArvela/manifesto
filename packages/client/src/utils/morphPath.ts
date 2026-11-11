/**
 * The path of a morph (`utils/morph.ts`): the straight line along which it
 * draws a panel, and the keyframes that draw it there. Only geometry, with no
 * element. Thus, the Node suite can test it.
 */

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
   * For the round corners of the window: a clip with the radius divided by the
   * scale on each axis. Its own animation, because an animation runs on the
   * compositor only when all of its properties can, and only some browsers
   * run a `clip-path` there (Chromium does). Null for square corners.
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
 * `radius` keeps the corners of the window round on the screen: the clip of
 * the corners has the radius divided by the scale on each axis. `scrollTop`
 * keeps a panel that was scrolled (a close of a long note) where it was,
 * because the clip resets its scroll.
 */
export function morphFrames(
  rect: RectLike,
  to: RectLike,
  radius: number,
  scrollTop: number,
): MorphFrame {
  const [scaleX, scaleY] = scaleOnto(to, rect);
  return {
    panel: plateFrame(to, rect),
    content: {
      transform: `scale(${1 / scaleX}, ${1 / scaleY}) translate(0px, ${-scrollTop}px)`,
    },
    corners: radius > 0 ? cornerFrame(rect, to, radius) : null,
  };
}

/** The scale on each axis that draws a box laid out at `box` over `rect`. */
function scaleOnto(box: RectLike, rect: RectLike): [number, number] {
  return [
    Math.max(box.width > 0 ? rect.width / box.width : 1, 0.001),
    Math.max(box.height > 0 ? rect.height / box.height : 1, 0.001),
  ];
}

/**
 * The keyframe that draws a box laid out at `box` over `rect`, with
 * `transform-origin` at its top left: the panel, and the shadows of a morph
 * (`utils/morphPlates.ts`). A move and a scale, which run on the compositor in
 * all browsers.
 */
export function plateFrame(box: RectLike, rect: RectLike): Keyframe {
  const [scaleX, scaleY] = scaleOnto(box, rect);
  return {
    transform: `translate(${rect.left - box.left}px, ${rect.top - box.top}px) scale(${scaleX}, ${scaleY})`,
  };
}

/**
 * The clip that gives a window laid out at `to` and drawn over `rect` corners
 * of `radius` on the screen.
 */
function cornerFrame(rect: RectLike, to: RectLike, radius: number): Keyframe {
  const [scaleX, scaleY] = scaleOnto(to, rect);
  return {
    clipPath: `inset(0px round ${radius / scaleX}px / ${radius / scaleY}px)`,
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
  /** Empty when a note has square corners at both ends. */
  corners: Keyframe[];
}

/**
 * The radius of the corners of the window at the start and at the end of a
 * path. A card has round corners, and the sheet of a phone has none. With one
 * radius the whole way, its corners changed at once at the end.
 */
export interface CornerPath {
  from: number;
  to: number;
}

/** One keyframe of a path: where it is in the run, and what it draws there. */
export interface PathStop {
  offset: number;
  rect: RectLike;
}

/**
 * The stops of `path`, as points on its line. Before `startAt`, the keyframes
 * stay at the start of the line. The animation never goes back there. The
 * panel and the shadows of a run use the same stops. Thus, each keyframe of
 * one has a keyframe of the others at the same offset.
 */
export function pathStops(path: MorphPath): PathStop[] {
  const { start, end, startAt } = path;
  const stops: PathStop[] = startAt > 0 ? [{ offset: 0, rect: start }] : [];
  for (const along of pathPoints(path)) {
    stops.push({
      offset: startAt + (1 - startAt) * along,
      rect: shownRect(start, end, along),
    });
  }
  return stops;
}

/**
 * The keyframes of `path` for the panel and its content, and for the corners
 * when there are round corners at either end. The radius and the opacity
 * change with the progress of the run.
 */
export function pathFrames(
  path: MorphPath,
  corners: CornerPath,
  scrollTop: number,
  opacity?: ((offset: number) => number) | undefined,
): PathFrames {
  const { layout } = path;
  const round = corners.from > 0 || corners.to > 0;
  const frames: PathFrames = { panel: [], content: [], corners: [] };
  for (const { offset, rect } of pathStops(path)) {
    const frame = morphFrames(rect, layout, 0, scrollTop);
    frames.panel.push({
      ...frame.panel,
      ...(opacity && { opacity: opacity(offset) }),
      offset,
    });
    frames.content.push({ ...frame.content, offset });
    if (round) {
      const radius = corners.from + (corners.to - corners.from) * offset;
      frames.corners.push({ ...cornerFrame(rect, layout, radius), offset });
    }
  }
  return frames;
}

/** The rectangle of `path` at `progress` of its run. */
export function pointOn(path: MorphPath, progress: number): RectLike {
  const along =
    path.startAt >= 1 ? 1 : (progress - path.startAt) / (1 - path.startAt);
  return shownRect(path.start, path.end, Math.max(0, along));
}
