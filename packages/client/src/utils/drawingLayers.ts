// The layers of a drawing on the pad, and the history of what was done to them.
// Each change makes a new sketch and keeps the old one. Thus, undo and redo
// only move between sketches, and a sketch shares the strokes it did not
// change. Pure: the pad draws it, and the tests need no canvas.

import {
  intersect,
  isClip,
  isFill,
  isShape,
  type Mark,
  markBounds,
  type PaperSize,
  type Rect,
  stretchMark,
  type Transform,
  transformMark,
  wholePaper,
} from "./drawing.ts";
import { MAX_IMAGE_EDGE } from "./shrinkImage.ts";

export interface Layer {
  /** Also the number in its name. A deleted layer does not give its number to a new one. */
  id: number;
  visible: boolean;
  /** From 0 to 1. Opaque when absent. */
  opacity?: number;
  marks: readonly Mark[];
}

export interface Sketch {
  /** From the bottom up: the last layer is on top. */
  layers: readonly Layer[];
  /** The id of the layer on which the pen draws. */
  active: number;
  nextId: number;
  /**
   * The part of the paper that the picture keeps, after a crop of the image.
   * The full paper when absent. Marks outside it stay, and show again on undo.
   */
  frame?: Rect;
  /**
   * The size of the paper after a change of the size of the image. The paper
   * of the pad when absent. The image under the drawing stretches to it.
   */
  paper?: PaperSize;
  /** The change that made this sketch, for the list of steps. None at the start. */
  step?: Step;
}

/** The kinds of change that are steps, as the history list names them. */
export type Step =
  | "pen"
  | "eraser"
  | "shape"
  | "fill"
  | "clearLayer"
  | "addLayer"
  | "removeLayer"
  | "toggleLayer"
  | "layerOpacity"
  | "moveLayer"
  | "orderLayer"
  | "cropLayer"
  | "movePixels"
  | "cropImage"
  | "canvasSize"
  | "imageSize";

export interface SketchHistory {
  past: readonly Sketch[];
  present: Sketch;
  future: readonly Sketch[];
  /**
   * The kind of the last change, when the next change of the same kind joins
   * it: the values of one slide of an opacity are one step, not a hundred.
   */
  joins?: string | undefined;
}

/** More layers than this are hard to tell apart in a list on a phone. */
export const MAX_LAYERS = 8;

export function newSketchHistory(): SketchHistory {
  return {
    past: [],
    present: {
      layers: [{ id: 1, visible: true, marks: [] }],
      active: 1,
      nextId: 2,
    },
    future: [],
  };
}

/**
 * The sketch after a change, as one step to undo. No step when nothing changed.
 * A change with the `joins` of the last one replaces it in the same step.
 */
function record(
  history: SketchHistory,
  step: Step,
  changed: Sketch,
  joins?: string,
): SketchHistory {
  if (changed === history.present) return history;
  const next = { ...changed, step };
  if (joins !== undefined && history.joins === joins) {
    return { ...history, present: next };
  }
  return {
    past: [...history.past, history.present],
    present: next,
    future: [],
    joins,
  };
}

/** The step of a new mark: what drew it. An area keeps the kind of its mark. */
function markStep(mark: Mark): Step {
  if (isFill(mark)) return "fill";
  if (isClip(mark)) {
    const [inner] = mark.marks;
    return mark.erase ? "eraser" : inner ? markStep(inner) : "pen";
  }
  if (isShape(mark)) return "shape";
  return mark.erase ? "eraser" : "pen";
}

function changeLayer(
  sketch: Sketch,
  id: number,
  change: (layer: Layer) => Layer,
): Sketch {
  return {
    ...sketch,
    layers: sketch.layers.map((layer) =>
      layer.id === id ? change(layer) : layer,
    ),
  };
}

export const activeLayer = (sketch: Sketch): Layer | undefined =>
  sketch.layers.find((layer) => layer.id === sketch.active);

/**
 * A mark on the active layer. A hidden layer shows again: a line that you
 * cannot see is not one you meant to draw.
 */
export function addMark(history: SketchHistory, mark: Mark): SketchHistory {
  const sketch = history.present;
  return record(
    history,
    markStep(mark),
    changeLayer(sketch, sketch.active, (layer) => ({
      ...layer,
      visible: true,
      marks: [...layer.marks, mark],
    })),
  );
}

/** Empties the active layer. The other layers stay. */
export function clearLayer(history: SketchHistory): SketchHistory {
  const sketch = history.present;
  if (!activeLayer(sketch)?.marks.length) return history;
  return record(
    history,
    "clearLayer",
    changeLayer(sketch, sketch.active, (layer) => ({ ...layer, marks: [] })),
  );
}

/** A new empty layer above the active one, which becomes active. */
export function addLayer(history: SketchHistory): SketchHistory {
  const sketch = history.present;
  if (sketch.layers.length >= MAX_LAYERS) return history;
  const at = sketch.layers.findIndex((layer) => layer.id === sketch.active) + 1;
  const layer: Layer = { id: sketch.nextId, visible: true, marks: [] };
  return record(history, "addLayer", {
    ...sketch,
    layers: [...sketch.layers.slice(0, at), layer, ...sketch.layers.slice(at)],
    active: layer.id,
    nextId: sketch.nextId + 1,
  });
}

/**
 * Removes a layer. The last layer stays, because the pen needs one. The layer
 * under the removed one becomes active, or the one over it at the bottom.
 */
export function removeLayer(history: SketchHistory, id: number): SketchHistory {
  const sketch = history.present;
  const at = sketch.layers.findIndex((layer) => layer.id === id);
  if (at < 0 || sketch.layers.length <= 1) return history;
  const layers = sketch.layers.filter((layer) => layer.id !== id);
  const next = layers[Math.max(0, at - 1)];
  return record(history, "removeLayer", {
    ...sketch,
    layers,
    active: sketch.active === id && next ? next.id : sketch.active,
  });
}

export function toggleLayer(history: SketchHistory, id: number): SketchHistory {
  return record(
    history,
    "toggleLayer",
    changeLayer(history.present, id, (layer) => ({
      ...layer,
      visible: !layer.visible,
    })),
  );
}

/** How opaque a layer is, from 0 to 1. One slide of it is one step. */
export function setLayerOpacity(
  history: SketchHistory,
  id: number,
  opacity: number,
): SketchHistory {
  const value = Math.min(1, Math.max(0, opacity));
  const layer = history.present.layers.find((each) => each.id === id);
  if (!layer || (layer.opacity ?? 1) === value) return history;
  return record(
    history,
    "layerOpacity",
    changeLayer(history.present, id, (each) => ({ ...each, opacity: value })),
    `opacity:${id}`,
  );
}

/** The same picture: the same layers, in the same order and look. */
const sameSketch = (a: Sketch, b: Sketch): boolean =>
  a.frame === b.frame &&
  a.layers.length === b.layers.length &&
  a.layers.every((layer, i) => {
    const other = b.layers[i];
    return (
      other !== undefined &&
      layer.id === other.id &&
      layer.marks === other.marks &&
      layer.visible === other.visible &&
      (layer.opacity ?? 1) === (other.opacity ?? 1)
    );
  });

/**
 * Ends a change that joins: the next one is a step of its own. A slide that
 * went back to where it started is no step at all.
 */
export function endJoin(history: SketchHistory): SketchHistory {
  if (history.joins === undefined) return history;
  const before = history.past.at(-1);
  if (before && sameSketch(before, history.present)) {
    return { ...history, past: history.past.slice(0, -1), joins: undefined };
  }
  return { ...history, joins: undefined };
}

/** The box of the ink of a layer, or null when it has no ink. */
export const layerBounds = (layer: Layer): Rect | null =>
  markBounds(layer.marks);

/** True when a layer has ink: an eraser alone adds none. */
export const hasInk = (layer: Layer): boolean => layerBounds(layer) !== null;

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
 * Gives the picture a new size, with the drawing and the image under it
 * stretched to fill it. Ink becomes pixels of the new size, as in any picture
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

/** Moves a layer one place up (+1) or down (-1). Nothing past the top or the bottom. */
export function moveLayer(
  history: SketchHistory,
  id: number,
  by: 1 | -1,
): SketchHistory {
  const sketch = history.present;
  const at = sketch.layers.findIndex((layer) => layer.id === id);
  const to = at + by;
  const layer = sketch.layers[at];
  const other = sketch.layers[to];
  if (at < 0 || !layer || !other) return history;
  const layers = [...sketch.layers];
  layers[at] = other;
  layers[to] = layer;
  return record(history, "orderLayer", { ...sketch, layers });
}

/**
 * The layer on which the pen draws. Not a step to undo: it changes nothing in
 * the drawing, and an undo that only moved the selection would look broken.
 */
export function selectLayer(history: SketchHistory, id: number): SketchHistory {
  if (!history.present.layers.some((layer) => layer.id === id)) return history;
  return { ...history, present: { ...history.present, active: id } };
}

/**
 * The history at one of its steps: `at` counts from the start, the sketch
 * before the first step. The steps after it stay, for redo.
 */
export function jumpTo(history: SketchHistory, at: number): SketchHistory {
  const all = [...history.past, history.present, ...history.future];
  const present = all[at];
  if (!present || present === history.present) return history;
  return {
    past: all.slice(0, at),
    present,
    future: all.slice(at + 1),
  };
}

export function undo(history: SketchHistory): SketchHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: SketchHistory): SketchHistory {
  const [next, ...future] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future };
}

/**
 * True when a layer has a mark, shown or not, or the image is cropped: a
 * drawing to lose on close.
 */
export const hasStrokes = (sketch: Sketch): boolean =>
  sketch.frame !== undefined ||
  sketch.layers.some((layer) => layer.marks.length > 0);

/**
 * True when the picture differs from the paper, or from the image under it:
 * something to save on Done.
 */
export const hasVisibleStrokes = (sketch: Sketch): boolean =>
  sketch.frame !== undefined ||
  sketch.layers.some(
    (layer) => layer.visible && (layer.opacity ?? 1) > 0 && hasInk(layer),
  );
