import {
  intersect,
  isFill,
  type Mark,
  type PaperSize,
  type Rect,
  stretchMark,
  type Transform,
  transformMark,
  wholePaper,
} from "./drawing.ts";
import {
  activeLayer,
  changeLayer,
  record,
  type SketchHistory,
} from "./drawingLayers.ts";
import { MAX_IMAGE_EDGE } from "./shrinkImage.ts";

// The changes to the ink and the size of a picture on the pad: a move, a
// resize or a crop of a layer or a selection, and the size of the canvas or
// the image. Each is one step of the history in `drawingLayers.ts`. Pure, as
// that file is.

/** Moves, or makes larger or smaller, all that is on the active layer. */
export function transformLayer(
  history: SketchHistory,
  by: Transform,
): SketchHistory {
  const sketch = history.present;
  if (by.scale === 1 && by.dx === 0 && by.dy === 0) return history;
  if (!activeLayer(sketch)?.marks.length) return history;
  return record(
    history,
    "moveLayer",
    changeLayer(sketch, sketch.active, (layer) => ({
      ...layer,
      marks: layer.marks.map((mark) => transformMark(mark, by)),
    })),
  );
}

/**
 * The active layer with its ink as one picture (`toPicture`), before a move,
 * a resize or a crop changes its pixels. Not a step: the drawing looks the
 * same, and the change after it is the step. A layer that is already one
 * picture stays.
 */
export function flattenActive(
  history: SketchHistory,
  toPicture: (marks: readonly Mark[]) => Mark | null,
): SketchHistory {
  const sketch = history.present;
  const layer = activeLayer(sketch);
  if (!layer?.marks.length) return history;
  const [only] = layer.marks;
  if (layer.marks.length === 1 && only && isFill(only)) return history;
  const picture = toPicture(layer.marks);
  return {
    ...history,
    present: changeLayer(sketch, sketch.active, (each) => ({
      ...each,
      marks: picture ? [picture] : [],
    })),
  };
}

/**
 * Cuts the marks of the active layer to `area`: the part outside it no longer
 * shows. Lines drawn later are not cut. Nothing when the layer is empty.
 */
export function cropLayer(
  history: SketchHistory,
  area: Rect,
  mask?: CanvasImageSource,
): SketchHistory {
  const sketch = history.present;
  if (!activeLayer(sketch)?.marks.length) return history;
  return record(
    history,
    "cropLayer",
    changeLayer(sketch, sketch.active, (layer) => ({
      ...layer,
      marks: [{ clip: area, ...(mask ? { mask } : {}), marks: layer.marks }],
    })),
  );
}

/**
 * Moves the ink of the active layer that is inside an area (`area`, in the
 * shape of `mask`) by `dx`, `dy`. The ink outside it stays. One step.
 */
export function moveSelected(
  history: SketchHistory,
  area: Rect,
  mask: CanvasImageSource,
  dx: number,
  dy: number,
): SketchHistory {
  const sketch = history.present;
  if (dx === 0 && dy === 0) return history;
  if (!activeLayer(sketch)?.marks.length) return history;
  return record(
    history,
    "movePixels",
    changeLayer(sketch, sketch.active, (layer) => ({
      ...layer,
      marks: movedMarks(layer.marks, area, mask, dx, dy),
    })),
  );
}

/**
 * Removes the ink of the active layer that is inside an area (`area`, in the
 * shape of `mask`). The ink outside it stays. One step.
 */
export function deleteSelected(
  history: SketchHistory,
  area: Rect,
  mask: CanvasImageSource,
): SketchHistory {
  const sketch = history.present;
  if (!activeLayer(sketch)?.marks.length) return history;
  return record(
    history,
    "deleteSelected",
    changeLayer(sketch, sketch.active, (layer) => ({
      ...layer,
      marks: [{ clip: area, mask, outside: true, marks: layer.marks }],
    })),
  );
}

/**
 * The marks of a layer after the ink inside an area moved: the ink outside it
 * in place, and a moved copy of the ink inside it.
 */
export const movedMarks = (
  marks: readonly Mark[],
  area: Rect,
  mask: CanvasImageSource,
  dx: number,
  dy: number,
): Mark[] => [
  { clip: area, mask, outside: true, marks },
  transformMark({ clip: area, mask, marks }, { scale: 1, dx, dy }),
];

/**
 * Makes the picture the part of it in `area`. Nothing when the area is outside
 * the picture.
 */
export function cropImage(
  history: SketchHistory,
  area: Rect,
  paper: Rect,
): SketchHistory {
  const sketch = history.present;
  const frame = intersect(area, sketch.frame ?? paper);
  if (!frame) return history;
  const whole = (value: number) => Math.round(value);
  const rounded = {
    x: whole(frame.x),
    y: whole(frame.y),
    width: Math.max(1, whole(frame.width)),
    height: Math.max(1, whole(frame.height)),
  };
  return record(history, "cropImage", { ...sketch, frame: rounded });
}

/** Where a change of the canvas keeps the picture: 0, 0.5 or 1 on each axis. */
export type Anchor = readonly [x: number, y: number];

/** The longest edge that a canvas or an image can have on the pad. */
export const MAX_EDGE = MAX_IMAGE_EDGE;

const edge = (value: number) =>
  Math.min(MAX_EDGE, Math.max(1, Math.round(value)));

/**
 * Gives the picture a new size, and keeps the drawing at its size. The
 * picture grows or shrinks around `anchor`. A larger canvas adds paper, and a
 * smaller one crops. Nothing when the size does not change.
 */
export function resizeCanvas(
  history: SketchHistory,
  paper: PaperSize,
  width: number,
  height: number,
  anchor: Anchor,
): SketchHistory {
  const sketch = history.present;
  const now = sketch.frame ?? wholePaper(sketch.paper ?? paper);
  const w = edge(width);
  const h = edge(height);
  if (w === now.width && h === now.height) return history;
  const frame = {
    x: Math.round(now.x + (now.width - w) * anchor[0]),
    y: Math.round(now.y + (now.height - h) * anchor[1]),
    width: w,
    height: h,
  };
  return record(history, "canvasSize", { ...sketch, frame });
}

/**
 * Gives the picture a new size, with all layers stretched to fill it. Ink becomes pixels of the new size, as in any picture
 * editor. Nothing when the size does not change.
 */
export function resizeImage(
  history: SketchHistory,
  paper: PaperSize,
  width: number,
  height: number,
): SketchHistory {
  const sketch = history.present;
  const own = sketch.paper ?? paper;
  const now = sketch.frame ?? wholePaper(own);
  const w = edge(width);
  const h = edge(height);
  if (w === now.width && h === now.height) return history;
  const sx = w / now.width;
  const sy = h / now.height;
  return record(history, "imageSize", {
    ...sketch,
    layers: sketch.layers.map((layer) => ({
      ...layer,
      marks: layer.marks.map((mark) => stretchMark(mark, sx, sy)),
    })),
    frame: {
      x: Math.round(now.x * sx),
      y: Math.round(now.y * sy),
      width: w,
      height: h,
    },
    paper: { width: own.width * sx, height: own.height * sy },
  });
}
