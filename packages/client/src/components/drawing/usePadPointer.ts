import {
  cornerPoint,
  type Mark,
  type Point,
  type Rect,
  resizeAround,
  type Transform,
} from "#/utils/drawing.ts";
import {
  activeLayer,
  addMark,
  layerBounds,
  type SketchHistory,
} from "#/utils/drawingLayers.ts";
import { closesPolygon, snapLine, snapSquare } from "#/utils/shapes.ts";
import { type CanvasBox, HANDLE } from "./canvasBox.ts";
import { type Gesture, UNCHANGED } from "./gesture.ts";
import {
  colorAt,
  cornerAt,
  fillMark,
  onPaper,
  onPicture,
  paperPoint,
  shownPaper,
} from "./paperPoints.ts";
import type { PenSettings } from "./pen.ts";
import { placePenCursor } from "./penCursor.ts";
import {
  lineMark,
  type MarkStyle,
  shapeMark,
  strokeWidth,
} from "./penMarks.ts";
import { showsPen, type Tool } from "./tools.ts";
import type { useCropTool } from "./useCropTool.ts";
import type { usePolygonTool } from "./usePolygonTool.ts";
import type { useSelectionTool } from "./useSelectionTool.ts";
import type { useViewport } from "./useViewport.ts";

type Ref<T> = { current: T };

/**
 * What a pointer does on the screen of the pad, for each tool: it starts a
 * gesture on the press, follows it on each move, and keeps it on release. It
 * also places the circle of the pen under the pointer.
 */
export function usePadPointer(pad: {
  screenRef: Ref<HTMLCanvasElement | null>;
  stageRef: Ref<HTMLDivElement | null>;
  cursorRef: Ref<HTMLDivElement | null>;
  dialogRef: Ref<HTMLDivElement | null>;
  boxRef: Ref<CanvasBox | null>;
  scaleRef: Ref<number>;
  historyRef: Ref<SketchHistory>;
  gesture: Ref<Gesture | null>;
  ready: boolean;
  tool: Tool;
  /** The tool to go back to after the eye dropper. */
  toolBefore: Ref<Tool>;
  setTool: (tool: Tool) => void;
  ink: string;
  setInk: (ink: string) => void;
  pen: PenSettings;
  style: () => MarkStyle;
  /** The box of the ink of the active layer, for the corners of the move tool. */
  inkBox: Rect | null;
  setDragBy: (by: Transform | null) => void;
  viewport: ReturnType<typeof useViewport>;
  polygonTool: ReturnType<typeof usePolygonTool>;
  selectTool: ReturnType<typeof useSelectionTool>;
  cropTool: ReturnType<typeof useCropTool>;
  context: () => CanvasRenderingContext2D | null;
  currentView: () => Rect;
  apply: (next: SketchHistory) => void;
  flatten: () => void;
  inSelection: (mark: Mark) => Mark;
  commitGesture: () => void;
  cacheAround: () => void;
  paintActive: () => void;
  schedule: () => void;
}) {
  const { gesture, historyRef, polygonTool, selectTool, cropTool } = pad;
  const { viewport, currentView } = pad;
  const polygon = polygonTool.polygon;

  const shownNow = () => shownPaper(pad.boxRef.current, pad.stageRef.current);
  const pointOf = (
    event: { clientX: number; clientY: number },
    shown: CanvasBox,
  ) => paperPoint(event, shown, currentView());
  const distance = (pixels: number, shown: CanvasBox) =>
    onPaper(pixels, shown, currentView());

  /**
   * The eye dropper: the ink becomes the color of the drawing where it was
   * pressed, as it shows, with all layers. Then the tool from before draws
   * with it.
   */
  const pickColor = (at: Point) => {
    const ctx = pad.context();
    if (!ctx) return;
    pad.setInk(colorAt(ctx, at, currentView()));
    pad.setTool(pad.toolBefore.current);
  };

  /** Flood fill, on the active layer. See `fillMark`. */
  const fillAt = (at: Point) => {
    const ctx = pad.context();
    const mark =
      ctx && fillMark(ctx, at, currentView(), pad.ink, pad.pen.opacity);
    if (mark) pad.apply(addMark(historyRef.current, pad.inSelection(mark)));
  };

  /**
   * The move tool: a press on the corner handle of the box of the ink changes
   * its size, and a press at any other place moves it. Nothing happens on an
   * empty layer.
   */
  const startDrag = (pointerId: number, start: Point, shown: CanvasBox) => {
    // A hidden layer does not move: you cannot see what you would move.
    if (!activeLayer(historyRef.current.present)?.visible) return;
    pad.flatten();
    const layer = activeLayer(historyRef.current.present);
    const bounds = layer ? layerBounds(layer) : null;
    if (!bounds) return;
    const corner = cornerAt(bounds, start, shown, currentView());
    pad.cacheAround();
    gesture.current = {
      kind: "drag",
      pointerId,
      corner,
      start,
      bounds,
      by: UNCHANGED,
    };
    pad.setDragBy(UNCHANGED);
    pad.paintActive();
  };

  const hideCursor = () => {
    if (pad.cursorRef.current) pad.cursorRef.current.style.display = "none";
  };

  const showCursor = (event: PointerEvent) => {
    const cursor = pad.cursorRef.current;
    const element = pad.stageRef.current;
    if (!cursor || !element || !pad.ready) return;
    if (!showsPen(pad.tool)) {
      hideCursor();
      return;
    }
    placePenCursor(cursor, element, event, {
      tip: pad.pen.tip,
      width: strokeWidth(pad.style()),
      scale: pad.scaleRef.current,
    });
  };

  const onPointerDown = (event: PointerEvent) => {
    const canvas = pad.screenRef.current;
    // One gesture at a time. A second finger, or a palm, is not a second pen.
    if (!canvas || !pad.ready || gesture.current || !event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    // The canvas cannot take focus. Without this, a press on it leaves focus
    // on the page body, and the keys of the pad (Ctrl or Cmd with A) never
    // come to the dialog.
    const dialog = pad.dialogRef.current;
    if (!dialog?.contains(document.activeElement)) {
      dialog?.focus({ preventScroll: true });
    }
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that the browser does not know now: the gesture still
      // starts. It only stops to follow past the edge of the paper.
    }
    const shown = shownNow();
    if (!shown) return;
    const at = pointOf(event, shown);
    const { pointerId } = event;
    const { tool } = pad;
    switch (tool) {
      case "dropper":
        if (onPicture(at, currentView())) pickColor(at);
        return;
      case "fill":
        if (onPicture(at, currentView())) fillAt(at);
        return;
      case "move":
        startDrag(pointerId, at, shown);
        return;
      case "select":
      case "selectEllipse":
      case "lasso":
      case "polyLasso":
        selectTool.begin(tool, pointerId, at, event, distance(HANDLE, shown));
        return;
      case "crop":
        cropTool.begin(pointerId, at);
        return;
      case "zoom":
        // A click zooms in at the pointer, and with Alt, out.
        viewport.zoomTo(
          event.altKey
            ? viewport.zoom / viewport.ZOOM_STEP
            : viewport.zoom * viewport.ZOOM_STEP,
          [event.clientX, event.clientY],
        );
        return;
      case "hand":
        gesture.current = {
          kind: "pan",
          pointerId,
          client: [event.clientX, event.clientY],
          center: viewport.center,
        };
        return;
      case "polygon": {
        const open = polygon.current;
        if (!open) {
          polygonTool.start(at);
          pad.cacheAround();
        } else if (closesPolygon(open.corners, at, distance(HANDLE, shown))) {
          polygonTool.finish();
          return;
        } else {
          open.corners.push(at);
        }
        pad.paintActive();
        return;
      }
      case "line":
        gesture.current = {
          kind: "shape",
          pointerId,
          start: at,
          mark: lineMark(pad.style(), [at, at]),
        };
        break;
      case "rect":
      case "ellipse":
        gesture.current = {
          kind: "shape",
          pointerId,
          start: at,
          mark: shapeMark(pad.style(), tool, [at, at]),
        };
        break;
      default:
        gesture.current = {
          kind: "stroke",
          pointerId,
          mark: lineMark(pad.style(), [at]),
        };
    }
    pad.cacheAround();
    pad.paintActive();
    showCursor(event);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.isPrimary) showCursor(event);
    const canvas = pad.screenRef.current;
    const shown = shownNow();
    if (!canvas || !shown) return;
    const open = polygon.current;
    if (open && !gesture.current) {
      open.hover = pointOf(event, shown);
      pad.schedule();
      return;
    }
    if (pad.tool === "move" && !gesture.current && pad.inkBox) {
      // The pointer shows when a press would change the size.
      const corner = cornerAt(
        pad.inkBox,
        pointOf(event, shown),
        shown,
        currentView(),
      );
      canvas.style.cursor =
        corner === null
          ? "move"
          : corner === "nw" || corner === "se"
            ? "nwse-resize"
            : "nesw-resize";
    }
    if (selectTool.tracing) {
      selectTool.hover(pointOf(event, shown));
      return;
    }
    if (selectTool.dragging(event.pointerId)) {
      selectTool.update(pointOf(event, shown));
      return;
    }
    if (cropTool.dragging(event.pointerId)) {
      cropTool.update(pointOf(event, shown));
      return;
    }
    const now = gesture.current;
    if (now?.pointerId !== event.pointerId) return;
    switch (now.kind) {
      case "pan":
        viewport.panTo([
          now.center[0] - (event.clientX - now.client[0]) / viewport.scale,
          now.center[1] - (event.clientY - now.client[1]) / viewport.scale,
        ]);
        return;
      case "drag": {
        const to = pointOf(event, shown);
        const { bounds, start } = now;
        if (now.corner) {
          // The corner follows the pointer from where the press took it.
          const [cx, cy] = cornerPoint(bounds, now.corner);
          now.by = resizeAround(bounds, now.corner, [
            cx + to[0] - start[0],
            cy + to[1] - start[1],
          ]);
        } else {
          now.by = { scale: 1, dx: to[0] - start[0], dy: to[1] - start[1] };
        }
        pad.setDragBy(now.by);
        pad.schedule();
        return;
      }
      case "shape": {
        const to = pointOf(event, shown);
        // Shift keeps a line at a step of 15 degrees, and a box square.
        const end = !event.shiftKey
          ? to
          : "shape" in now.mark
            ? snapSquare(now.start, to)
            : snapLine(now.start, to);
        now.mark = { ...now.mark, points: [now.start, end] };
        pad.schedule();
        return;
      }
      case "stroke": {
        // Each position through which the pointer went since the last frame,
        // where the browser kept them. If not, a fast hand draws corners.
        const events = event.getCoalescedEvents?.() ?? [];
        for (const each of events.length > 0 ? events : [event]) {
          now.mark.points.push(pointOf(each, shown));
        }
        pad.schedule();
      }
    }
  };

  const endGesture = (event: PointerEvent) => {
    if (gesture.current?.pointerId === event.pointerId) pad.commitGesture();
    if (selectTool.dragging(event.pointerId)) selectTool.end();
    if (cropTool.dragging(event.pointerId)) cropTool.end();
    // A finger leaves the screen: there is no place to show the pen at.
    if (event.pointerType === "touch") hideCursor();
  };

  return { onPointerDown, onPointerMove, endGesture, hideCursor };
}
