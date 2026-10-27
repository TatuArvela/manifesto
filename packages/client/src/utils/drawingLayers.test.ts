import { describe, expect, it } from "vitest";
import { isClip, isFill, type Mark, type Stroke } from "./drawing.ts";
import {
  activeLayer,
  addLayer,
  addMark,
  clearLayer,
  cropImage,
  cropLayer,
  deleteSelected,
  endJoin,
  flattenActive,
  hasStrokes,
  hasVisibleStrokes,
  jumpTo,
  MAX_LAYERS,
  moveLayer,
  newSketchHistory,
  redo,
  removeLayer,
  renameLayer,
  resizeCanvas,
  resizeImage,
  selectLayer,
  setLayerOpacity,
  toggleLayer,
  transformLayer,
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

/** The first point of a mark that is a stroke. */
const firstPoint = (mark: Mark | undefined) =>
  mark && !isClip(mark) && !isFill(mark) ? mark.points[0] : undefined;

const ids = (history: ReturnType<typeof newSketchHistory>) =>
  history.present.layers.map((layer) => layer.id);

describe("drawing layers", () => {
  it("opens an image as the bottom layer, under the layer the pen draws on", () => {
    const image = {} as CanvasImageSource;
    const history = newSketchHistory({
      image,
      paper: { width: 300, height: 600 },
      name: "Picture",
    });
    const [picture, drawn] = history.present.layers;
    expect(picture).toEqual({
      id: 0,
      visible: true,
      name: "Picture",
      marks: [{ image, at: { x: 0, y: 0, width: 300, height: 600 } }],
    });
    expect(drawn).toEqual({ id: 1, visible: true, marks: [] });
    expect(history.present.active).toBe(1);
    expect(history.past).toEqual([]);
  });

  it("starts with one empty layer and nothing to undo", () => {
    const history = newSketchHistory();
    expect(ids(history)).toEqual([1]);
    expect(history.past).toEqual([]);
    expect(hasStrokes(history.present)).toBe(false);
  });

  it("puts a stroke on the active layer only", () => {
    let history = addMark(newSketchHistory(), line(1));
    history = addLayer(history);
    history = addMark(history, line(2));
    const [bottom, top] = history.present.layers;
    expect(bottom?.marks).toEqual([line(1)]);
    expect(top?.marks).toEqual([line(2)]);
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
    let history = addMark(newSketchHistory(), line(1));
    history = toggleLayer(history, 1);
    expect(hasVisibleStrokes(history.present)).toBe(false);
    expect(hasStrokes(history.present)).toBe(true);
    history = addMark(history, line(2));
    expect(activeLayer(history.present)?.visible).toBe(true);
  });

  it("clears the active layer only", () => {
    let history = addMark(newSketchHistory(), line(1));
    history = addMark(addLayer(history), line(2));
    history = clearLayer(history);
    expect(history.present.layers.map((l) => l.marks.length)).toEqual([1, 0]);
    // An empty layer: nothing to clear, and no step to undo.
    expect(clearLayer(history)).toBe(history);
  });

  it("deletes the selected area on the active layer only", () => {
    const area = { x: 0, y: 0, width: 10, height: 10 };
    const mask = {} as CanvasImageSource;
    let history = addMark(newSketchHistory(), line(1));
    history = addMark(addLayer(history), line(2));
    history = deleteSelected(history, area, mask);
    expect(history.present.step).toBe("deleteSelected");
    expect(history.present.layers[0]?.marks).toEqual([line(1)]);
    expect(activeLayer(history.present)?.marks).toEqual([
      { clip: area, mask, outside: true, marks: [line(2)] },
    ]);
    history = undo(history);
    expect(activeLayer(history.present)?.marks).toEqual([line(2)]);
    // An empty layer: nothing to delete, and no step to undo.
    const empty = addLayer(history);
    expect(deleteSelected(empty, area, mask)).toBe(empty);
  });

  it("names a layer, and an empty name gives back the number", () => {
    let history = addMark(newSketchHistory(), line(1));
    const id = history.present.active;
    history = renameLayer(history, id, "  Sky  ");
    expect(activeLayer(history.present)?.name).toBe("Sky");
    expect(history.present.step).toBe("renameLayer");
    // The same name: no step.
    expect(renameLayer(history, id, "Sky")).toBe(history);
    expect(
      renameLayer(history, id, "x".repeat(60)).present.layers[0]?.name,
    ).toHaveLength(40);
    history = renameLayer(history, id, "   ");
    expect(activeLayer(history.present)).not.toHaveProperty("name");
    history = undo(history);
    expect(activeLayer(history.present)?.name).toBe("Sky");
  });

  it("undoes and redoes each change, a clear also", () => {
    let history = addMark(newSketchHistory(), line(1));
    history = addMark(history, line(2));
    history = clearLayer(history);
    history = undo(history);
    expect(activeLayer(history.present)?.marks).toEqual([line(1), line(2)]);
    history = undo(history);
    expect(activeLayer(history.present)?.marks).toEqual([line(1)]);
    history = redo(redo(history));
    expect(activeLayer(history.present)?.marks).toEqual([]);
    expect(redo(history)).toBe(history);
    expect(undo(newSketchHistory())).toEqual(newSketchHistory());
  });

  it("forgets what was undone when a new change comes", () => {
    let history = addMark(newSketchHistory(), line(1));
    history = undo(history);
    history = addMark(history, line(2));
    expect(history.future).toEqual([]);
    expect(activeLayer(history.present)?.marks).toEqual([line(2)]);
  });

  it("undoes the removal of a layer with its strokes, and its place", () => {
    let history = addMark(newSketchHistory(), line(1));
    history = addMark(addLayer(history), line(2));
    history = removeLayer(history, 1);
    history = undo(history);
    expect(ids(history)).toEqual([1, 2]);
    expect(history.present.layers[0]?.marks).toEqual([line(1)]);
  });

  it("does not make a step of the choice of a layer", () => {
    const history = addLayer(newSketchHistory());
    const chosen = selectLayer(history, 1);
    expect(chosen.past).toBe(history.past);
    expect(chosen.present.active).toBe(1);
    expect(selectLayer(history, 99)).toBe(history);
  });

  it("makes one slide of an opacity one step, and a new slide a new step", () => {
    let history = addMark(newSketchHistory(), line(1));
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

  it("makes no step of a slide that ends where it started", () => {
    let history = addMark(newSketchHistory(), line(1));
    history = setLayerOpacity(history, 1, 0.4);
    history = setLayerOpacity(history, 1, 1);
    history = endJoin(history);
    expect(history.past).toHaveLength(1);
    expect(history.joins).toBeUndefined();
    // A new slide is a step of its own, not a part of the old one.
    history = endJoin(setLayerOpacity(history, 1, 0.5));
    expect(undo(history).present.layers[0]?.opacity).toBe(1);
  });

  it("has nothing to save for an eraser alone, or a layer at no opacity", () => {
    const rub: Stroke = { ...line(1), erase: true };
    const erased = addMark(newSketchHistory(), rub);
    expect(hasVisibleStrokes(erased.present)).toBe(false);
    expect(hasStrokes(erased.present)).toBe(true);
    const faded = setLayerOpacity(addMark(newSketchHistory(), line(1)), 1, 0);
    expect(hasVisibleStrokes(faded.present)).toBe(false);
  });

  it("does not join a stroke to the slide before it", () => {
    let history = setLayerOpacity(newSketchHistory(), 1, 0.5);
    history = addMark(history, line(1));
    history = setLayerOpacity(history, 1, 0.4);
    expect(history.past).toHaveLength(3);
  });

  it("moves the active layer only, as one step", () => {
    let history = addMark(newSketchHistory(), line(1));
    history = addMark(addLayer(history), line(2));
    history = transformLayer(history, { scale: 1, dx: 5, dy: 0 });
    const [bottom, top] = history.present.layers;
    expect(firstPoint(bottom?.marks[0])).toEqual([1, 0]);
    expect(firstPoint(top?.marks[0])).toEqual([7, 0]);
    expect(firstPoint(undo(history).present.layers[1]?.marks[0])).toEqual([
      2, 0,
    ]);
    // No move, or an empty layer: no step.
    const still = transformLayer(history, { scale: 1, dx: 0, dy: 0 });
    expect(still).toBe(history);
    const empty = addLayer(history);
    expect(transformLayer(empty, { scale: 2, dx: 0, dy: 0 })).toBe(empty);
  });

  it("makes the ink of the active layer one picture, with no step to undo", () => {
    const picture: Mark = {
      image: {} as CanvasImageSource,
      at: { x: 0, y: 0, width: 4, height: 10 },
    };
    let history = addMark(newSketchHistory(), line(0));
    history = addMark(history, line(2));
    const flat = flattenActive(history, () => picture);
    expect(activeLayer(flat.present)?.marks).toEqual([picture]);
    expect(flat.past).toBe(history.past);
    // A layer that is one picture already stays as it is.
    expect(flattenActive(flat, () => null)).toBe(flat);
    // The undo goes to the step before the last line, with lines.
    expect(activeLayer(undo(flat).present)?.marks).toHaveLength(1);
  });

  it("cuts the marks of a layer to an area, and leaves later lines whole", () => {
    let history = addMark(newSketchHistory(), line(1));
    const area = { x: 0, y: 0, width: 5, height: 5 };
    history = cropLayer(history, area);
    history = addMark(history, line(2));
    expect(activeLayer(history.present)?.marks).toEqual([
      { clip: area, marks: [line(1)] },
      line(2),
    ]);
    expect(undo(undo(history)).present.layers[0]?.marks).toEqual([line(1)]);
    const empty = newSketchHistory();
    expect(cropLayer(empty, area)).toBe(empty);
  });

  it("moves a cut group with its area", () => {
    let history = addMark(newSketchHistory(), line(1));
    history = cropLayer(history, { x: 0, y: 0, width: 5, height: 5 });
    history = transformLayer(history, { scale: 2, dx: 10, dy: 0 });
    const [group] = activeLayer(history.present)?.marks ?? [];
    expect(group && isClip(group) ? group.clip : null).toEqual({
      x: 10,
      y: 0,
      width: 10,
      height: 10,
    });
  });

  it("keeps the crop when a layer is added", () => {
    const paper = { x: 0, y: 0, width: 100, height: 100 };
    const area = { x: 10, y: 20, width: 30, height: 40 };
    const history = addLayer(cropImage(newSketchHistory(), area, paper));
    expect(history.present.frame).toEqual(area);
    expect(history.present.layers).toHaveLength(2);
  });

  it("crops the picture inside what it shows, in whole pixels", () => {
    const paper = { x: 0, y: 0, width: 100, height: 100 };
    let history = cropImage(
      newSketchHistory(),
      { x: 10.4, y: 20.6, width: 200, height: 30 },
      paper,
    );
    expect(history.present.frame).toEqual({
      x: 10,
      y: 21,
      width: 90,
      height: 30,
    });
    // A second crop stays inside the first.
    history = cropImage(history, { x: 0, y: 0, width: 50, height: 50 }, paper);
    expect(history.present.frame).toEqual({
      x: 10,
      y: 21,
      width: 40,
      height: 29,
    });
    // A crop is a change to keep, also with no ink.
    expect(hasVisibleStrokes(history.present)).toBe(true);
    expect(undo(undo(history)).present.frame).toBeUndefined();
    const outside = { x: 500, y: 500, width: 5, height: 5 };
    expect(cropImage(history, outside, paper)).toBe(history);
  });
});

describe("the size of the picture", () => {
  const paper = { width: 100, height: 50 };

  it("grows the canvas around the anchor, and keeps the drawing", () => {
    const drawn = addMark(newSketchHistory(), line(10));
    const next = resizeCanvas(drawn, paper, 200, 50, [0.5, 0.5]);
    expect(next.present.frame).toEqual({
      x: -50,
      y: 0,
      width: 200,
      height: 50,
    });
    expect(firstPoint(activeLayer(next.present)?.marks[0])).toEqual([10, 0]);
    // From the top left corner, the picture grows to the right and down.
    const corner = resizeCanvas(drawn, paper, 120, 60, [0, 0]);
    expect(corner.present.frame).toEqual({
      x: 0,
      y: 0,
      width: 120,
      height: 60,
    });
    expect(undo(next).present.frame).toBeUndefined();
  });

  it("stretches the drawing and the paper to a new image size", () => {
    const drawn = addMark(newSketchHistory(), line(10));
    const next = resizeImage(drawn, paper, 200, 25);
    expect(next.present.paper).toEqual({ width: 200, height: 25 });
    expect(next.present.frame).toEqual({ x: 0, y: 0, width: 200, height: 25 });
    const mark = activeLayer(next.present)?.marks[0];
    expect(firstPoint(mark)).toEqual([20, 0]);
    expect(mark && "width" in mark ? mark.width : 0).toBeCloseTo(4);
  });

  it("changes nothing at the same size", () => {
    const drawn = addMark(newSketchHistory(), line(10));
    expect(resizeCanvas(drawn, paper, 100, 50, [0, 0])).toBe(drawn);
    expect(resizeImage(drawn, paper, 100, 50)).toBe(drawn);
  });
});

describe("the list of steps", () => {
  it("names each step by what made it", () => {
    let history = addMark(newSketchHistory(), line(10));
    history = addMark(history, { ...line(20), erase: true });
    history = addLayer(history);
    expect(history.past.map((sketch) => sketch.step)).toEqual([
      undefined,
      "pen",
      "eraser",
    ]);
    expect(history.present.step).toBe("addLayer");
  });

  it("jumps to a step, and keeps the steps after it for redo", () => {
    let history = addMark(newSketchHistory(), line(10));
    history = addMark(history, line(20));
    history = addMark(history, line(30));
    const back = jumpTo(history, 1);
    expect(back.past).toHaveLength(1);
    expect(back.future).toHaveLength(2);
    expect(activeLayer(back.present)?.marks).toHaveLength(1);
    expect(jumpTo(back, 3).present).toBe(history.present);
    expect(jumpTo(back, 1)).toBe(back);
    // A new change after a jump replaces the steps after it.
    expect(addMark(back, line(40)).future).toHaveLength(0);
  });
});
