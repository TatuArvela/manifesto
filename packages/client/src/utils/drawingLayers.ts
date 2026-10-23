// The layers of a drawing on the pad, and the history of what was done to them.
// Each change makes a new sketch and keeps the old one. Thus, undo and redo
// only move between sketches, and a sketch shares the strokes it did not
// change. Pure: the pad draws it, and the tests need no canvas.

import {
  intersect,
  type Mark,
  markBounds,
  type Rect,
  type Transform,
  transformMark,
} from "./drawing.ts";

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
}

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
  next: Sketch,
  joins?: string,
): SketchHistory {
  if (next === history.present) return history;
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
    changeLayer(sketch, sketch.active, (layer) => ({ ...layer, marks: [] })),
  );
}

/** A new empty layer above the active one, which becomes active. */
export function addLayer(history: SketchHistory): SketchHistory {
  const sketch = history.present;
  if (sketch.layers.length >= MAX_LAYERS) return history;
  const at = sketch.layers.findIndex((layer) => layer.id === sketch.active) + 1;
  const layer: Layer = { id: sketch.nextId, visible: true, marks: [] };
  return record(history, {
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
  return record(history, {
    ...sketch,
    layers,
    active: sketch.active === id && next ? next.id : sketch.active,
  });
}

export function toggleLayer(history: SketchHistory, id: number): SketchHistory {
  return record(
    history,
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
    changeLayer(history.present, id, (each) => ({ ...each, opacity: value })),
    `opacity:${id}`,
  );
}

/** Ends a change that joins: the next one is a step of its own. */
export const endJoin = (history: SketchHistory): SketchHistory =>
  history.joins === undefined ? history : { ...history, joins: undefined };

/** The box of the ink of a layer, or null for an empty layer. */
export const layerBounds = (layer: Layer): Rect | null =>
  markBounds(layer.marks);

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
    changeLayer(sketch, sketch.active, (layer) => ({
      ...layer,
      marks: layer.marks.map((mark) => transformMark(mark, by)),
    })),
  );
}

/**
 * Cuts the marks of the active layer to `area`: the part outside it no longer
 * shows. Lines drawn later are not cut. Nothing when the layer is empty.
 */
export function cropLayer(history: SketchHistory, area: Rect): SketchHistory {
  const sketch = history.present;
  if (!activeLayer(sketch)?.marks.length) return history;
  return record(
    history,
    changeLayer(sketch, sketch.active, (layer) => ({
      ...layer,
      marks: [{ clip: area, marks: layer.marks }],
    })),
  );
}

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
  return record(history, { ...sketch, frame: rounded });
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
  return record(history, { ...sketch, layers });
}

/**
 * The layer on which the pen draws. Not a step to undo: it changes nothing in
 * the drawing, and an undo that only moved the selection would look broken.
 */
export function selectLayer(history: SketchHistory, id: number): SketchHistory {
  if (!history.present.layers.some((layer) => layer.id === id)) return history;
  return { ...history, present: { ...history.present, active: id } };
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
  sketch.layers.some((layer) => layer.visible && layer.marks.length > 0);
