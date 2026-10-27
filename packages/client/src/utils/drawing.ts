// A drawing as the strokes from which it was made, and how they are put on a
// canvas. Kept separate from the pad that collects them. Thus, the geometry can
// be tested without a pointer.

import type { Layer } from "./drawingLayers.ts";

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
   * Thus, it never paints over the image under the drawing.
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
 * The area of a flood fill, as a picture of it in its color. A fill follows
 * the pixels that showed at the press. Thus, it is a picture, not a line, and
 * a large resize of it is less sharp.
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

/** The tilt of the oval tip, as a pen held in a right hand. */
const OVAL_ANGLE = -Math.PI / 4;
/** The oval tip is this much narrower than it is wide. */
const OVAL_RATIO = 0.35;

/**
 * Where a tip that is not round presses its shape: at each point, and between
 * points at steps short enough that the shapes join into a line.
 */
export function stampCenters(points: readonly Point[], width: number): Point[] {
  const step = Math.max(1, width / 6);
  const [first, ...rest] = points;
  if (!first) return [];
  const centers: Point[] = [first];
  let previous = first;
  for (const point of rest) {
    const dx = point[0] - previous[0];
    const dy = point[1] - previous[1];
    const steps = Math.ceil(Math.hypot(dx, dy) / step);
    for (let i = 1; i <= steps; i++) {
      centers.push([
        previous[0] + (dx * i) / steps,
        previous[1] + (dy * i) / steps,
      ]);
    }
    previous = point;
  }
  return centers;
}

/** Adds the shape of the tip, centred on `at`, to the path in progress. */
export function tipPath(
  ctx: CanvasRenderingContext2D | Path2D,
  tip: PenTip,
  width: number,
  at: Point,
): void {
  const half = width / 2;
  if (tip === "square") {
    ctx.rect(at[0] - half, at[1] - half, width, width);
    return;
  }
  // Each shape starts a path of its own at its own edge. A line from the last
  // shape would close it into a wedge.
  if (tip === "oval") {
    ctx.moveTo(
      at[0] + half * Math.cos(OVAL_ANGLE),
      at[1] + half * Math.sin(OVAL_ANGLE),
    );
    ctx.ellipse(
      at[0],
      at[1],
      half,
      half * OVAL_RATIO,
      OVAL_ANGLE,
      0,
      Math.PI * 2,
    );
  } else {
    ctx.moveTo(at[0] + half, at[1]);
    ctx.arc(at[0], at[1], half, 0, Math.PI * 2);
  }
}

/**
 * One stroke. A round tip is a line through the middle of each pair of points,
 * with the points themselves as the handles of the curve. A hand that moves
 * fast leaves points far apart, and straight segments between them show each
 * corner. A different tip is one path of its shapes along the line. One path,
 * filled one time: where the shapes overlap, a transparent ink does not become
 * darker.
 */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
): void {
  const [first, ...rest] = stroke.points;
  if (!first) return;
  const tip = stroke.tip ?? "round";
  ctx.globalCompositeOperation = stroke.erase
    ? "destination-out"
    : "source-over";
  ctx.globalAlpha = stroke.opacity ?? 1;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (tip !== "round") {
    for (const at of stampCenters(stroke.points, stroke.width)) {
      tipPath(ctx, tip, stroke.width, at);
    }
    ctx.fill("nonzero");
  } else if (
    // A tap, or a finger that pushed and never moved. A path with no length
    // draws nothing. Thus, it is a dot with the width of the pen.
    rest.every((point) => point[0] === first[0] && point[1] === first[1])
  ) {
    ctx.arc(first[0], first[1], stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(first[0], first[1]);
    let previous = first;
    for (const point of rest) {
      ctx.quadraticCurveTo(
        previous[0],
        previous[1],
        (previous[0] + point[0]) / 2,
        (previous[1] + point[1]) / 2,
      );
      previous = point;
    }
    ctx.lineTo(previous[0], previous[1]);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

/** The full paper, as the part of it that a drawing shows. */
export const wholePaper = (paper: PaperSize): Rect => ({
  x: 0,
  y: 0,
  width: paper.width,
  height: paper.height,
});

/** An empty, transparent canvas of a size. */
export function blankCanvas(size: PaperSize): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  return canvas;
}

/**
 * `kept` again when it has the size, or a new canvas. A canvas of a large photo
 * holds tens of megabytes, and a phone has a limit for all of them together.
 * The contents stay: the caller paints over them.
 */
export const reusedCanvas = (
  kept: HTMLCanvasElement | null | undefined,
  size: PaperSize,
): HTMLCanvasElement =>
  kept && kept.width === size.width && kept.height === size.height
    ? kept
    : blankCanvas(size);

/**
 * The context of a canvas that ink is drawn on. On the GPU, Chrome changes how
 * it smooths the edge of a path as the path gets long: a line in progress
 * moves, and moves again at the release. On the CPU, the edge stays the same.
 * The live frames use it too, so that a line keeps its shape at the release.
 */
export const CPU_INK: CanvasRenderingContext2DSettings = {
  willReadFrequently: true,
};

/** The canvas on which `renderDrawing` paints each layer before it adds it. */
let layerScratch: HTMLCanvasElement | null = null;

/** The outline of a shape, as a path in progress. */
export function shapePath(
  ctx: CanvasRenderingContext2D | Path2D,
  shape: Pick<Shape, "shape" | "points">,
): void {
  const [a, b] = shape.points;
  if (!a) return;
  if (shape.shape === "polygon") {
    ctx.moveTo(a[0], a[1]);
    for (const point of shape.points.slice(1)) ctx.lineTo(point[0], point[1]);
    ctx.closePath();
    return;
  }
  if (!b) return;
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  const width = Math.abs(b[0] - a[0]);
  const height = Math.abs(b[1] - a[1]);
  if (shape.shape === "rect") {
    ctx.rect(x, y, width, height);
    return;
  }
  ctx.moveTo(x + width, y + height / 2);
  ctx.ellipse(
    x + width / 2,
    y + height / 2,
    width / 2,
    height / 2,
    0,
    0,
    Math.PI * 2,
  );
}

/** A shape: its inside first, then its outline over it. */
export function drawShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  ctx.globalAlpha = shape.opacity ?? 1;
  ctx.beginPath();
  shapePath(ctx, shape);
  if (shape.fill) {
    ctx.fillStyle = shape.fill;
    ctx.fill();
  }
  if (shape.color && shape.width > 0) {
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.width;
    // A box keeps square corners. The corners of a polygon can be very sharp,
    // and a mitre would go far past them.
    ctx.lineJoin = shape.shape === "rect" ? "miter" : "round";
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Marks in order. A group is cut to its area, and its marks only. */
export function drawMarks(
  ctx: CanvasRenderingContext2D,
  marks: readonly Mark[],
): void {
  for (const mark of marks) {
    if (isFill(mark)) {
      ctx.globalAlpha = mark.opacity ?? 1;
      ctx.drawImage(
        mark.image,
        mark.at.x,
        mark.at.y,
        mark.at.width,
        mark.at.height,
      );
      ctx.globalAlpha = 1;
      continue;
    }
    if (isShape(mark)) {
      drawShape(ctx, mark);
      continue;
    }
    if (!isClip(mark)) {
      drawStroke(ctx, mark);
      continue;
    }
    if (mark.mask) {
      drawMasked(ctx, mark, mark.mask);
      continue;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(mark.clip.x, mark.clip.y, mark.clip.width, mark.clip.height);
    ctx.clip();
    drawMarks(ctx, mark.marks);
    ctx.restore();
  }
}

/** Canvases for the groups with a mask, one for each depth of nesting. */
const maskScratch: HTMLCanvasElement[] = [];
let maskDepth = 0;

/**
 * The pixels of the canvas that a box of the paper covers, under the
 * transform of `ctx`, rounded out to whole pixels and held inside the canvas.
 * Null when it is outside the canvas.
 */
function canvasArea(ctx: CanvasRenderingContext2D, box: Rect) {
  const m = ctx.getTransform();
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ] as const) {
    xs.push(m.a * px + m.c * py + m.e);
    ys.push(m.b * px + m.d * py + m.f);
  }
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const right = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs)));
  const bottom = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys)));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * A group with a mask: its marks on a canvas of their own, cut to the mask
 * there, then put on the drawing. As ink, or, for an eraser, as the ink that
 * goes. A clip path cannot have holes, and a mask can.
 *
 * Inside a mask, the work stays in the box of the mask on the canvas: a line
 * in a small selected area does not cost a pass over the whole picture. Ink
 * outside a mask can be anywhere, and takes the whole canvas.
 */
function drawMasked(
  ctx: CanvasRenderingContext2D,
  mark: Clip,
  mask: CanvasImageSource,
): void {
  const { width, height } = ctx.canvas;
  const area = mark.outside
    ? { x: 0, y: 0, width, height }
    : canvasArea(ctx, mark.clip);
  if (!area) return;
  const scratch = reusedCanvas(maskScratch[maskDepth], { width, height });
  maskScratch[maskDepth] = scratch;
  const own = scratch.getContext("2d", CPU_INK);
  if (!own) return;
  own.save();
  own.setTransform(1, 0, 0, 1, 0, 0);
  own.clearRect(area.x, area.y, area.width, area.height);
  // Drawing and compositing outside the area would only cost time.
  own.beginPath();
  own.rect(area.x, area.y, area.width, area.height);
  own.clip();
  own.setTransform(ctx.getTransform());
  maskDepth++;
  try {
    drawMarks(own, mark.marks);
  } finally {
    maskDepth--;
  }
  // Destination-in keeps the marks where the mask is, and clears all the
  // rest of the area. Destination-out takes away what is inside the mask.
  own.globalCompositeOperation = mark.outside
    ? "destination-out"
    : "destination-in";
  const { x, y, width: w, height: h } = mark.clip;
  own.drawImage(mask, x, y, w, h);
  own.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (mark.erase) ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(
    scratch,
    area.x,
    area.y,
    area.width,
    area.height,
    area.x,
    area.y,
    area.width,
    area.height,
  );
  ctx.restore();
}

/**
 * The marks of one layer on `scratch`, from nothing, with `view` as the part
 * of the paper that the canvas shows. On its own canvas, an eraser takes away
 * only the ink of that layer.
 */
export function paintLayer(
  scratch: HTMLCanvasElement,
  marks: readonly Mark[],
  view: Pick<Rect, "x" | "y"> = { x: 0, y: 0 },
): void {
  const ctx = scratch.getContext("2d", CPU_INK);
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, scratch.width, scratch.height);
  ctx.setTransform(1, 0, 0, 1, -view.x, -view.y);
  drawMarks(ctx, marks);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Fewer pixels than the limit of one canvas in Safari, with some to spare. */
const MAX_LAYER_PIXELS = 16_000_000;

/**
 * The part of the plane where a layer keeps ink: the paper, and a margin
 * around it. Ink can go past the edge of the paper and come back. The area is
 * at most twice the paper on each axis, and stays inside the pixel limit of a
 * canvas.
 */
export function inkArea(paper: PaperSize): Rect {
  const grow = Math.min(
    2,
    Math.sqrt(MAX_LAYER_PIXELS / (paper.width * paper.height)),
  );
  const width = Math.floor(paper.width * grow);
  const height = Math.floor(paper.height * grow);
  return {
    x: Math.round((paper.width - width) / 2),
    y: Math.round((paper.height - height) / 2),
    width,
    height,
  };
}

/**
 * The ink of marks as one picture, in whole pixels, cut to `area`. Null when
 * they have no ink there. A move or a resize after it changes pixels, not
 * lines: this is a bitmap pad.
 */
export function rasterize(marks: readonly Mark[], area: Rect): Fill | null {
  const ink = markBounds(marks);
  const shown = ink && intersect(ink, area);
  if (!shown) return null;
  const x = Math.floor(shown.x);
  const y = Math.floor(shown.y);
  const at = {
    x,
    y,
    width: Math.ceil(shown.x + shown.width) - x,
    height: Math.ceil(shown.y + shown.height) - y,
  };
  const image = blankCanvas(at);
  paintLayer(image, marks, at);
  return { image, at };
}

/**
 * The full drawing from nothing: paper, the image under the drawing if there is
 * one, then each layer that shows, from the bottom up. The paper stays under
 * the image. Thus, an image with transparent parts is as opaque as all other
 * drawings. With `onlyLayers`, it is the given layers alone, on a transparent
 * ground: the pad keeps those under and over the line in progress. The canvas
 * is the size of `view`, the part of the paper that the picture keeps after a
 * crop.
 */
export function renderDrawing(
  ctx: CanvasRenderingContext2D,
  layers: readonly Layer[],
  paper: PaperSize = BLANK_PAPER,
  base: CanvasImageSource | null = null,
  onlyLayers = false,
  view: Rect = wholePaper(paper),
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (onlyLayers) {
    ctx.clearRect(0, 0, view.width, view.height);
  } else {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, view.width, view.height);
    if (base) {
      ctx.drawImage(base, -view.x, -view.y, paper.width, paper.height);
    }
  }
  let scratch: HTMLCanvasElement | null = null;
  for (const layer of layers) {
    if (!layer.visible || layer.marks.length === 0) continue;
    scratch ??= layerScratch = reusedCanvas(layerScratch, view);
    paintLayer(scratch, layer.marks, view);
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.drawImage(scratch, 0, 0);
    ctx.globalAlpha = 1;
  }
}

/** Above this, a PNG is a photograph, not line art, and is saved as one. */
const PNG_BYTES = 1024 * 1024;
const PHOTO_QUALITY = 0.92;

const encoded = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * The canvas as the bytes of an image file, or null where the browser made
 * none. A PNG, which keeps a line sharp however frequently the drawing opens
 * again, unless it is drawn over a photograph. As a PNG, that becomes many
 * megabytes, more than a note accepts. Thus, it is a JPEG, as the photograph
 * was.
 */
export async function encodeDrawing(
  canvas: HTMLCanvasElement,
  overImage: boolean,
): Promise<Blob | null> {
  const png = await encoded(canvas, "image/png");
  if (!png || !overImage || png.size <= PNG_BYTES) return png;
  const jpeg = await encoded(canvas, "image/jpeg", PHOTO_QUALITY);
  return jpeg && jpeg.type === "image/jpeg" && jpeg.size < png.size
    ? jpeg
    : png;
}
