// A drawing as the strokes from which it was made: the paper, the marks, and
// how they move. Kept separate from the pad that collects them and from the
// canvas that shows them. Thus, the geometry can be tested without a pointer.

/** The own size of the drawing, whatever size it shows at: 4 by 3. */
export const DRAWING_WIDTH = 1600;
export const DRAWING_HEIGHT = 1200;

export interface PaperSize {
  width: number;
  height: number;
}

/** The paper of a new drawing. */
export const BLANK_PAPER: PaperSize = {
  width: DRAWING_WIDTH,
  height: DRAWING_HEIGHT,
};

/**
 * The paper for a drawing over an image: the own size of the image. Thus, the
 * image under the drawing keeps its pixels, and is not stretched. Null for an
 * image with almost no size.
 */
export function paperSizeFor(image: PaperSize): PaperSize | null {
  if (!(image.width > 0 && image.height > 0)) return null;
  return { width: Math.round(image.width), height: Math.round(image.height) };
}

/**
 * Paper: a drawing is opaque. Thus, it looks the same on a note of any color
 * and in both themes, where transparent ink on a dark note would disappear.
 */
export const PAPER = "#ffffff";

export type Point = readonly [x: number, y: number];

/**
 * The shape of the tip of the pen. Round draws a smooth line. Square and oval
 * press their shape at each small step along the line, as a broad nib does:
 * the oval is tilted. Thus, a line is thin in one direction and wide in the
 * other.
 */
export type PenTip = "round" | "square" | "oval";

export interface Stroke {
  color: string;
  /** In the own pixels of the drawing. */
  width: number;
  points: Point[];
  /**
   * Takes ink away from its own layer, and leaves what is under that layer.
   * Thus, it never paints over the layers under it.
   */
  erase?: boolean;
  /** Round when absent. */
  tip?: PenTip;
  /** From 0 to 1. Opaque when absent. */
  opacity?: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A change of size and place: a point goes to `point * scale + (dx, dy)`. */
export interface Transform {
  scale: number;
  dx: number;
  dy: number;
}

/**
 * The marks that were on a layer when it was cropped, and the area that they
 * still show in. Marks drawn after the crop are outside the group, and are not
 * cut. A group in a group is a second crop.
 */
export interface Clip {
  clip: Rect;
  /**
   * A shape in the box `clip`: opaque where the marks show. Without it, they
   * show in all of the box. A selected area of any shape makes it.
   */
  mask?: CanvasImageSource | undefined;
  /** The marks show outside the mask, not inside it. */
  outside?: boolean | undefined;
  /**
   * The marks take ink away from the layer, inside the mask: an eraser in a
   * selected area. They are drawn as ink, and that ink is what goes.
   */
  erase?: boolean | undefined;
  marks: readonly Mark[];
}

export type ShapeKind = "rect" | "ellipse" | "polygon";

/**
 * A box, an ellipse in a box, or a polygon. A box and an ellipse have the two
 * corners of the box as points; a polygon has its corners. The outline is in
 * `color`, the inside in `fill`. Each one is absent when it is not drawn.
 */
export interface Shape {
  shape: ShapeKind;
  points: Point[];
  width: number;
  color?: string;
  fill?: string;
  /** From 0 to 1. Opaque when absent. */
  opacity?: number;
}

/**
 * A picture on a layer: the area of a flood fill in its color, or the image
 * that the pad opened. A fill follows the pixels that showed at the press.
 * Thus, it is a picture, not a line, and a large resize of it is less sharp.
 */
export interface Fill {
  image: CanvasImageSource;
  at: Rect;
  opacity?: number;
}

/** What a layer contains: lines, shapes, fills, and groups of them cut to an area. */
export type Mark = Stroke | Shape | Fill | Clip;

export const isClip = (mark: Mark): mark is Clip => "clip" in mark;
export const isShape = (mark: Mark): mark is Shape => "shape" in mark;
export const isFill = (mark: Mark): mark is Fill => "image" in mark;

/** The area that two boxes share, or null when they do not touch. */
export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** A line or a shape, with its points and the width of its pen. */
export function transformStroke<T extends Stroke | Shape>(
  mark: T,
  by: Transform,
): T {
  return {
    ...mark,
    width: mark.width * by.scale,
    points: mark.points.map(
      ([x, y]): Point => [x * by.scale + by.dx, y * by.scale + by.dy],
    ),
  };
}

export const transformRect = (rect: Rect, by: Transform): Rect => ({
  x: rect.x * by.scale + by.dx,
  y: rect.y * by.scale + by.dy,
  width: rect.width * by.scale,
  height: rect.height * by.scale,
});

export function transformMark(mark: Mark, by: Transform): Mark {
  if (isFill(mark)) return { ...mark, at: transformRect(mark.at, by) };
  if (!isClip(mark)) return transformStroke(mark, by);
  return {
    ...mark,
    clip: transformRect(mark.clip, by),
    marks: mark.marks.map((each) => transformMark(each, by)),
  };
}

/**
 * A mark at another size, `sx` times as wide and `sy` times as tall, from the
 * corner of the plane. A line becomes as much wider as the area it covers.
 */
export function stretchMark(mark: Mark, sx: number, sy: number): Mark {
  const box = (rect: Rect): Rect => ({
    x: rect.x * sx,
    y: rect.y * sy,
    width: rect.width * sx,
    height: rect.height * sy,
  });
  if (isFill(mark)) return { ...mark, at: box(mark.at) };
  if (isClip(mark)) {
    return {
      ...mark,
      clip: box(mark.clip),
      marks: mark.marks.map((each) => stretchMark(each, sx, sy)),
    };
  }
  return {
    ...mark,
    width: mark.width * Math.sqrt(sx * sy),
    points: mark.points.map(([x, y]): Point => [x * sx, y * sy]),
  };
}

/**
 * The box that the ink of the strokes covers, the width of the tip included.
 * A square tip reaches further at its corners. Null when there is no ink: no
 * marks, or only an eraser.
 */
export function markBounds(marks: readonly Mark[]): Rect | null {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  const include = (box: Rect) => {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  };
  for (const mark of marks) {
    if (isClip(mark)) {
      // An eraser adds no ink, and ink outside a mask can be anywhere.
      if (mark.erase) continue;
      const inner = markBounds(mark.marks);
      const shown = mark.outside ? inner : inner && intersect(inner, mark.clip);
      if (shown) include(shown);
      continue;
    }
    if (isFill(mark)) {
      include(mark.at);
      continue;
    }
    // An eraser takes ink away, and adds none.
    if (!isShape(mark) && mark.erase) continue;
    const reach =
      isShape(mark) || mark.tip !== "square"
        ? mark.width / 2
        : (mark.width / 2) * Math.SQRT2;
    for (const [x, y] of mark.points) {
      include({
        x: x - reach,
        y: y - reach,
        width: reach * 2,
        height: reach * 2,
      });
    }
  }
  if (left > right) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A corner of a box: north west (top left) to south east (bottom right). */
export type Corner = "nw" | "ne" | "sw" | "se";

export const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];

/** Where a corner of a box is. */
export const cornerPoint = (box: Rect, corner: Corner): Point => [
  corner === "nw" || corner === "sw" ? box.x : box.x + box.width,
  corner === "nw" || corner === "ne" ? box.y : box.y + box.height,
];

const opposite: Record<Corner, Corner> = {
  nw: "se",
  ne: "sw",
  sw: "ne",
  se: "nw",
};

/**
 * The size change that takes `corner` of `box` to `to`, and keeps the
 * opposite corner in place. The same scale on both axes, so that a circle
 * stays a circle: the axis that moved further sets it.
 */
export function resizeAround(
  box: Rect,
  corner: Corner,
  to: Point,
  min = 0.05,
  max = 20,
): Transform {
  const [ax, ay] = cornerPoint(box, opposite[corner]);
  const towardX = corner === "ne" || corner === "se" ? 1 : -1;
  const towardY = corner === "sw" || corner === "se" ? 1 : -1;
  const scale = Math.min(
    max,
    Math.max(
      min,
      ((to[0] - ax) * towardX) / Math.max(1, box.width),
      ((to[1] - ay) * towardY) / Math.max(1, box.height),
    ),
  );
  return { scale, dx: ax * (1 - scale), dy: ay * (1 - scale) };
}

/**
 * Where a pointer is on the drawing, from where it is on the screen. The canvas
 * shows smaller than it is. Thus, both axes scale by that ratio.
 */
export function drawingPoint(
  pointer: { clientX: number; clientY: number },
  shown: { left: number; top: number; width: number; height: number },
  paper: PaperSize = BLANK_PAPER,
): Point {
  const x = ((pointer.clientX - shown.left) / shown.width) * paper.width;
  const y = ((pointer.clientY - shown.top) / shown.height) * paper.height;
  return [
    Math.min(paper.width, Math.max(0, x)),
    Math.min(paper.height, Math.max(0, y)),
  ];
}

/** The full paper, as the part of it that a drawing shows. */
export const wholePaper = (paper: PaperSize): Rect => ({
  x: 0,
  y: 0,
  width: paper.width,
  height: paper.height,
});
