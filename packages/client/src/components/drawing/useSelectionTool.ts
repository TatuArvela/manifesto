import { useRef, useState } from "preact/hooks";
import type { Point, Rect } from "#/utils/drawing.ts";
import {
  combineSelection,
  invertSelection,
  moveSelection,
  type Selection,
  type SelectMode,
  type SelectShape,
  selectAll,
  selectionContains,
  shapeBounds,
} from "#/utils/selection.ts";
import { closesPolygon } from "#/utils/shapes.ts";
import type { SelectionMove, SelectTool } from "./tools.ts";

/** The corners of a polygonal lasso in progress, and where the pointer is. */
interface Trace {
  mode: SelectMode;
  corners: Point[];
  hover: Point | null;
}

/** A drag shorter than this, in paper pixels, is a tap, not an area. */
const MIN_SELECTION = 4;

type Drag =
  | {
      kind: "shape";
      pointerId: number;
      mode: SelectMode;
      start: Point;
      shape: SelectShape;
    }
  | {
      kind: "move";
      pointerId: number;
      start: Point;
      offset: Point;
      pixels: boolean;
    };

/**
 * The selected area of the pad, and the drags of the two selection tools.
 *
 * A drag of Select draws a rectangle, of Ellipse select an ellipse, and of
 * Lasso a freehand shape. Polygonal lasso adds a corner with each press, and
 * a press on the first corner or a double click closes it. The shape makes a new area, adds to it with Shift, takes away from it with
 * Alt, or keeps only the part that both share with Shift and Alt (or as the
 * options choose). A tap clears the area. A drag that
 * starts inside the area moves it, or moves the ink in it, as the options
 * choose.
 */
export function useSelectionTool({
  view,
  onMovePixels,
  onPixelFrames,
}: {
  /** The part of the paper that shows: the area stays inside it. */
  view: () => Rect;
  /** Keeps the move of the ink in an area, as one step. */
  onMovePixels: (selection: Selection, dx: number, dy: number) => void;
  /** Starts, shows and ends the frames of a move of the ink. */
  onPixelFrames: (phase: "start" | "frame" | "end") => void;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [mode, setMode] = useState<SelectMode>("replace");
  const [move, setMove] = useState<SelectionMove>("selection");
  // The shape of the drag in progress, and how far a drag moved the area.
  const [draft, setDraft] = useState<SelectShape | null>(null);
  const [offset, setOffset] = useState<Point>([0, 0]);
  const drag = useRef<Drag | null>(null);
  const trace = useRef<Trace | null>(null);
  const [tracing, setTracing] = useState(false);

  const showTrace = (now: Trace) =>
    setDraft({
      kind: "lasso",
      points: now.hover ? [...now.corners, now.hover] : [...now.corners],
    });

  /** Closes the polygonal lasso in progress, and keeps its area. */
  const finishTrace = () => {
    const now = trace.current;
    if (!now) return;
    trace.current = null;
    setTracing(false);
    setDraft(null);
    // A double click presses twice on one place.
    const points = now.corners.filter((point, i, all) => {
      const before = all[i - 1];
      return (
        !before || Math.hypot(point[0] - before[0], point[1] - before[1]) > 1
      );
    });
    const shape: SelectShape = { kind: "lasso", points };
    if (shapeBounds(shape)) {
      setSelection(combineSelection(selection, shape, now.mode, view()));
    }
  };

  /** Ends the polygonal lasso in progress with no change to the area. */
  const cancelTrace = () => {
    if (!trace.current) return;
    trace.current = null;
    setTracing(false);
    setDraft(null);
  };

  const begin = (
    tool: SelectTool,
    pointerId: number,
    at: Point,
    keys: { shiftKey: boolean; altKey: boolean },
    /** How near to the first corner a press closes a polygonal lasso. */
    reach: number,
  ) => {
    const open = trace.current;
    if (open) {
      if (closesPolygon(open.corners, at, reach)) {
        finishTrace();
      } else {
        open.corners.push(at);
        showTrace(open);
      }
      return;
    }
    const chosen: SelectMode =
      keys.altKey && keys.shiftKey
        ? "intersect"
        : keys.altKey
          ? "subtract"
          : keys.shiftKey
            ? "add"
            : mode;
    if (chosen === "replace" && selection && selectionContains(selection, at)) {
      const pixels = move === "pixels";
      drag.current = {
        kind: "move",
        pointerId,
        start: at,
        offset: [0, 0],
        pixels,
      };
      if (pixels) onPixelFrames("start");
      return;
    }
    if (tool === "polyLasso") {
      trace.current = { mode: chosen, corners: [at], hover: null };
      setTracing(true);
      showTrace(trace.current);
      return;
    }
    const empty = { x: at[0], y: at[1], width: 0, height: 0 };
    const shape: SelectShape =
      tool === "select"
        ? { kind: "rect", rect: empty }
        : tool === "selectEllipse"
          ? { kind: "ellipse", rect: empty }
          : { kind: "lasso", points: [at] };
    drag.current = { kind: "shape", pointerId, mode: chosen, start: at, shape };
    setDraft(shape);
  };

  const update = (at: Point) => {
    const now = drag.current;
    if (!now) return;
    if (now.kind === "move") {
      now.offset = [
        Math.round(at[0] - now.start[0]),
        Math.round(at[1] - now.start[1]),
      ];
      setOffset(now.offset);
      if (now.pixels) onPixelFrames("frame");
      return;
    }
    const [sx, sy] = now.start;
    now.shape =
      now.shape.kind !== "lasso"
        ? {
            kind: now.shape.kind,
            rect: {
              x: Math.min(at[0], sx),
              y: Math.min(at[1], sy),
              width: Math.abs(at[0] - sx),
              height: Math.abs(at[1] - sy),
            },
          }
        : { kind: "lasso", points: [...now.shape.points, at] };
    setDraft(now.shape);
  };

  const end = () => {
    const now = drag.current;
    if (!now) return;
    drag.current = null;
    if (now.kind === "move") {
      setOffset([0, 0]);
      if (!selection) return;
      const [dx, dy] = now.offset;
      if (now.pixels) {
        onPixelFrames("end");
        onMovePixels(selection, dx, dy);
      }
      setSelection(moveSelection(selection, dx, dy));
      return;
    }
    setDraft(null);
    const box = shapeBounds(now.shape);
    // A tap, not a drag: no area, and a tap of a new selection clears it.
    if (!box || (box.width < MIN_SELECTION && box.height < MIN_SELECTION)) {
      if (now.mode === "replace") setSelection(null);
      return;
    }
    setSelection(combineSelection(selection, now.shape, now.mode, view()));
  };

  /** Follows the pointer with the open side of a polygonal lasso. */
  const hover = (at: Point) => {
    const now = trace.current;
    if (!now) return;
    now.hover = at;
    showTrace(now);
  };

  /** How far a drag moved the ink of the area, while it lasts. */
  const pixelOffset = (): Point | null => {
    const now = drag.current;
    return now?.kind === "move" && now.pixels ? now.offset : null;
  };

  return {
    selection,
    setSelection,
    mode,
    setMode,
    move,
    setMove,
    draft,
    offset,
    begin,
    update,
    end,
    tracing,
    hover,
    finishTrace,
    cancelTrace,
    selectAll: () => setSelection(selectAll(view())),
    invert: () => setSelection(invertSelection(selection, view())),
    dragging: (pointerId: number) => drag.current?.pointerId === pointerId,
    pixelOffset,
  };
}
