import { describe, expect, it } from "vitest";
import type { Stroke } from "./drawing.ts";
import {
  activeLayer,
  addLayer,
  addStroke,
  clearLayer,
  endJoin,
  hasStrokes,
  hasVisibleStrokes,
  MAX_LAYERS,
  moveLayer,
  newSketchHistory,
  redo,
  removeLayer,
  selectLayer,
  setLayerOpacity,
  toggleLayer,
  undo,
} from "./drawingLayers.ts";

const line = (x: number): Stroke => ({
  color: "#000",
  width: 4,
  points: [
    [x, 0],
    [x, 10],
  ],
});

const ids = (history: ReturnType<typeof newSketchHistory>) =>
  history.present.layers.map((layer) => layer.id);

describe("drawing layers", () => {
  it("starts with one empty layer and nothing to undo", () => {
    const history = newSketchHistory();
    expect(ids(history)).toEqual([1]);
    expect(history.past).toEqual([]);
    expect(hasStrokes(history.present)).toBe(false);
  });

  it("puts a stroke on the active layer only", () => {
    let history = addStroke(newSketchHistory(), line(1));
    history = addLayer(history);
    history = addStroke(history, line(2));
    const [bottom, top] = history.present.layers;
    expect(bottom?.strokes).toEqual([line(1)]);
    expect(top?.strokes).toEqual([line(2)]);
  });

  it("adds a layer over the active one, and makes it active", () => {
    let history = addLayer(newSketchHistory());
    history = selectLayer(history, 1);
    history = addLayer(history);
    expect(ids(history)).toEqual([1, 3, 2]);
    expect(history.present.active).toBe(3);
  });

  it("stops at the most layers", () => {
    let history = newSketchHistory();
    for (let i = 0; i < MAX_LAYERS + 3; i++) history = addLayer(history);
    expect(history.present.layers).toHaveLength(MAX_LAYERS);
  });

  it("keeps the last layer, and moves the pen to the one under a removed layer", () => {
    expect(removeLayer(newSketchHistory(), 1)).toEqual(newSketchHistory());
    let history = addLayer(addLayer(newSketchHistory()));
    history = removeLayer(history, 3);
    expect(ids(history)).toEqual([1, 2]);
    expect(history.present.active).toBe(2);
    history = removeLayer(history, 1);
    expect(ids(history)).toEqual([2]);
    expect(history.present.active).toBe(2);
  });

  it("moves a layer up and down, and not past either end", () => {
    let history = addLayer(addLayer(newSketchHistory()));
    history = moveLayer(history, 1, 1);
    expect(ids(history)).toEqual([2, 1, 3]);
    const before = history;
    expect(moveLayer(history, 3, 1)).toBe(before);
    expect(moveLayer(history, 2, -1)).toBe(before);
  });

  it("hides a layer, and shows it again when the pen draws on it", () => {
    let history = addStroke(newSketchHistory(), line(1));
    history = toggleLayer(history, 1);
    expect(hasVisibleStrokes(history.present)).toBe(false);
    expect(hasStrokes(history.present)).toBe(true);
    history = addStroke(history, line(2));
    expect(activeLayer(history.present)?.visible).toBe(true);
  });

  it("clears the active layer only", () => {
    let history = addStroke(newSketchHistory(), line(1));
    history = addStroke(addLayer(history), line(2));
    history = clearLayer(history);
    expect(history.present.layers.map((l) => l.strokes.length)).toEqual([1, 0]);
    // An empty layer: nothing to clear, and no step to undo.
    expect(clearLayer(history)).toBe(history);
  });

  it("undoes and redoes each change, a clear also", () => {
    let history = addStroke(newSketchHistory(), line(1));
    history = addStroke(history, line(2));
    history = clearLayer(history);
    history = undo(history);
    expect(activeLayer(history.present)?.strokes).toEqual([line(1), line(2)]);
    history = undo(history);
    expect(activeLayer(history.present)?.strokes).toEqual([line(1)]);
    history = redo(redo(history));
    expect(activeLayer(history.present)?.strokes).toEqual([]);
    expect(redo(history)).toBe(history);
    expect(undo(newSketchHistory())).toEqual(newSketchHistory());
  });

  it("forgets what was undone when a new change comes", () => {
    let history = addStroke(newSketchHistory(), line(1));
    history = undo(history);
    history = addStroke(history, line(2));
    expect(history.future).toEqual([]);
    expect(activeLayer(history.present)?.strokes).toEqual([line(2)]);
  });

  it("undoes the removal of a layer with its strokes, and its place", () => {
    let history = addStroke(newSketchHistory(), line(1));
    history = addStroke(addLayer(history), line(2));
    history = removeLayer(history, 1);
    history = undo(history);
    expect(ids(history)).toEqual([1, 2]);
    expect(history.present.layers[0]?.strokes).toEqual([line(1)]);
  });

  it("does not make a step of the choice of a layer", () => {
    const history = addLayer(newSketchHistory());
    const chosen = selectLayer(history, 1);
    expect(chosen.past).toBe(history.past);
    expect(chosen.present.active).toBe(1);
    expect(selectLayer(history, 99)).toBe(history);
  });

  it("makes one slide of an opacity one step, and a new slide a new step", () => {
    let history = addStroke(newSketchHistory(), line(1));
    for (const value of [0.9, 0.7, 0.5]) {
      history = setLayerOpacity(history, 1, value);
    }
    expect(history.past).toHaveLength(2);
    expect(activeLayer(history.present)?.opacity).toBe(0.5);
    history = setLayerOpacity(endJoin(history), 1, 0.2);
    expect(history.past).toHaveLength(3);
    history = undo(history);
    expect(activeLayer(history.present)?.opacity).toBe(0.5);
    history = undo(history);
    expect(activeLayer(history.present)?.opacity).toBeUndefined();
  });

  it("does not join a stroke to the slide before it", () => {
    let history = setLayerOpacity(newSketchHistory(), 1, 0.5);
    history = addStroke(history, line(1));
    history = setLayerOpacity(history, 1, 0.4);
    expect(history.past).toHaveLength(3);
  });
});
