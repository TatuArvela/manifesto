import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { useBackToClose } from "#/hooks/useBackToClose.ts";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { useFocusTrap } from "#/hooks/useFocusTrap.ts";
import { isTypingTarget } from "#/hooks/useShortcut.ts";
import { t } from "#/i18n/index.ts";
import { askConfirmation } from "#/state/confirm.ts";
import { closeDrawing, drawingRequest } from "#/state/drawing.ts";
import {
  drawingPoint,
  encodeDrawing,
  type Mark,
  PAPER,
  type Point,
  penScale,
  type Rect,
  renderDrawing,
  resizeFrom,
  type Shape,
  type Stroke,
  type Transform,
  transformRect,
  wholePaper,
} from "#/utils/drawing.ts";
import {
  activeLayer,
  addMark,
  clearLayer,
  cropImage,
  cropLayer,
  hasInk,
  hasStrokes,
  hasVisibleStrokes,
  layerBounds,
  newSketchHistory,
  redo,
  type SketchHistory,
  transformLayer,
  undo,
} from "#/utils/drawingLayers.ts";
import { fillPicture, floodFill, growArea } from "#/utils/floodFill.ts";
import { closesPolygon, snapLine, snapSquare } from "#/utils/shapes.ts";
import { DrawingHints } from "./DrawingHints.tsx";
import type { MoveTarget } from "./DrawingMoveOptions.tsx";
import { DrawingOverlay, HANDLE, useCanvasBox } from "./DrawingOverlay.tsx";
import { type PenSettings, WIDTHS } from "./DrawingPen.tsx";
import { DrawingToolbar, INKS, type Tool } from "./DrawingToolbar.tsx";
import { DrawingTopBar } from "./DrawingTopBar.tsx";
import { type Gesture, UNCHANGED } from "./gesture.ts";
import { placePenCursor } from "./penCursor.ts";
import { useBaseImage } from "./useBaseImage.ts";
import { useLiveFrames } from "./useLiveFrames.ts";
import { useStageZoom } from "./useStageZoom.ts";

/** The eraser is wider than the pen, wide enough to rub with. */
const ERASER_SCALE = 4;

/** A drag shorter than this, in paper pixels, is a tap, not an area. */
const MIN_SELECTION = 4;

/** A color of the canvas as `#rrggbb`, which a color field accepts. */
const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * The areas of the pad. On a phone: the paper, then the rows of controls under
 * it. On a wide screen: the tools at the left, the inks at the right, and the
 * options of the tool over the paper. The rows of the options and of the hint
 * keep their height when they are empty: the paper does not change size when
 * a tool with no options, or with no hint, is chosen.
 */
const padGrid =
  "grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_minmax(2.75rem,auto)_auto_auto_auto] [grid-template-areas:'top'_'stage'_'hint'_'options'_'inks'_'tools'] md:grid-cols-[auto_minmax(0,1fr)_auto] md:grid-rows-[auto_3rem_minmax(0,1fr)_2.75rem] md:[grid-template-areas:'top_top_top'_'tools_options_inks'_'tools_stage_inks'_'tools_hint_inks']";

/**
 * The drawing pad: a sheet of paper on which you draw with a finger, a pen or a
 * mouse. It becomes an image on the note, as all attachments do. When you open
 * it with one of the images of the note, that image is the paper, in its own
 * shape, and the new lines go over it.
 *
 * One pointer draws at a time, the pointer that went down first. The pad
 * ignores a second finger, and does not start a separate line for it. No
 * gesture of the page (scroll, pinch, the back swipe) takes the stroke away,
 * because only the canvas has `touch-action: none`. The stroke follows the
 * pointer through a capture. Thus, it continues past the edge of the paper, and
 * ends cleanly when the system cancels the touch.
 *
 * The drawing has layers, and each change is a step that undo takes back and
 * redo does again. All of it is for this session: Done flattens what shows into
 * one picture.
 */
export function DrawingPad() {
  const request = drawingRequest.value;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<SketchHistory>(newSketchHistory());
  const [history, setHistory] = useState(historyRef.current);
  const gesture = useRef<Gesture | null>(null);
  // The corners of a polygon in progress, and where the pointer is.
  const polygon = useRef<{ corners: Point[]; hover: Point | null } | null>(
    null,
  );
  const [drawingPolygon, setDrawingPolygon] = useState(false);
  // The drag of the move tool as the box over the ink shows it.
  const [dragBy, setDragBy] = useState<Transform | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget>("layer");
  // The move tool moves the area only while there is one.
  const movingSelection = moveTarget === "selection" && selection !== null;
  const box = useCanvasBox(canvasRef);
  const [ink, setInk] = useState<string>(INKS[0].color);
  const [backInk, setBackInk] = useState<string>(INKS[1].color);
  const [pen, setPen] = useState<PenSettings>({
    width: WIDTHS[1],
    tip: "round",
    opacity: 1,
    shapes: "outline",
  });
  const [tool, setTool] = useState<Tool>("pen");
  const toolBefore = useRef<Tool>("pen");
  const erasing = tool === "eraser";
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const { base, paper, ready } = useBaseImage(request?.base);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  const context = () => canvasRef.current?.getContext("2d") ?? null;

  /** The part of the paper that the picture shows: all of it, until a crop. */
  const currentView = () =>
    historyRef.current.present.frame ?? wholePaper(paper);
  const view = history.present.frame ?? wholePaper(paper);
  const { zoom, fit, zoomTo, onWheel, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } =
    useStageZoom(stageRef, canvasRef, view);

  const redraw = () => {
    const ctx = context();
    if (ctx) {
      renderDrawing(
        ctx,
        historyRef.current.present.layers,
        paper,
        base.current,
        false,
        currentView(),
      );
    }
  };

  /** The drawing after a change, on the canvas and in the controls. */
  const apply = (next: SketchHistory) => {
    if (next === historyRef.current) return;
    historyRef.current = next;
    setHistory(next);
    redraw();
  };

  // The paper, before anything is drawn on it and before the first frame. A
  // canvas starts transparent, which looks black over the dark ground of the
  // pad. It is emptied again when the image to draw over gives it a new size,
  // and when a crop does.
  // biome-ignore lint/correctness/useExhaustiveDependencies: as the canvas arrives, and as its paper or its crop changes
  useLayoutEffect(redraw, [
    paper,
    ready,
    view.x,
    view.y,
    view.width,
    view.height,
  ]);

  /**
   * A new mark, cut to the selected area while there is one: as in a picture
   * editor, the selection limits where the pen, the eraser, the shapes and the
   * fill apply. The area stays with the mark, also after the selection ends.
   */
  const inSelection = (mark: Mark): Mark =>
    selection ? { clip: selection, marks: [mark] } : mark;

  /** Marks that the frame shows on the active layer, not yet in the sketch. */
  const previewMarks = (): Mark[] => {
    const now = gesture.current;
    if (now?.kind === "stroke" || now?.kind === "shape") {
      return [inSelection(now.mark)];
    }
    const open = polygon.current;
    if (open) {
      const corners = open.hover ? [...open.corners, open.hover] : open.corners;
      return [inSelection(shapeMark("polygon", corners))];
    }
    return [];
  };

  const { paintActive, schedule, cacheAround, endFrames } = useLiveFrames({
    context,
    sketch: () => historyRef.current.present,
    view: currentView,
    paper,
    base: base.current,
    moving: () =>
      gesture.current?.kind === "drag" ? gesture.current.by : null,
    preview: () => previewMarks(),
  });

  /** The width of the pen, the eraser or an outline, on this paper. */
  const strokeWidth = () =>
    (erasing ? pen.width * ERASER_SCALE : pen.width) * penScale(paper);

  const shapeMark = (kind: Shape["shape"], points: Point[]): Shape => ({
    shape: kind,
    points,
    width: strokeWidth(),
    ...(pen.shapes === "filled" ? {} : { color: ink }),
    ...(pen.shapes === "outline" ? {} : { fill: backInk }),
    ...(pen.opacity < 1 ? { opacity: pen.opacity } : {}),
  });

  const lineMark = (points: Point[]): Stroke => ({
    color: erasing ? PAPER : ink,
    width: strokeWidth(),
    points,
    ...(erasing ? { erase: true } : {}),
    ...(pen.tip === "round" ? {} : { tip: pen.tip }),
    ...(pen.opacity < 1 ? { opacity: pen.opacity } : {}),
  });

  /** Ends the gesture, and keeps what it made, if anything. */
  const commitGesture = () => {
    const now = gesture.current;
    if (!now) return;
    gesture.current = null;
    if (now.kind === "select") {
      // A tap, not a drag: no area, and a tap clears the one there was.
      setSelection((area) =>
        area && area.width >= MIN_SELECTION && area.height >= MIN_SELECTION
          ? area
          : null,
      );
      return;
    }
    if (now.kind === "pan") return;
    endFrames();
    if (now.kind === "drag") {
      // The area is already where the drag left it.
      if (now.target === "selection") return;
      setDragBy(null);
      apply(transformLayer(historyRef.current, now.by));
      // Nothing moved: the canvas still shows the cached layer.
      redraw();
      return;
    }
    if (now.kind === "shape" && "shape" in now.mark) {
      const [a, b] = now.mark.points;
      // A box with no size is a tap, and draws nothing.
      if (!a || !b || a[0] === b[0] || a[1] === b[1]) {
        redraw();
        return;
      }
    }
    apply(addMark(historyRef.current, inSelection(now.mark)));
  };

  /** Closes the polygon in progress and keeps it, with three corners or more. */
  const finishPolygon = () => {
    const open = polygon.current;
    polygon.current = null;
    setDrawingPolygon(false);
    endFrames();
    // A double click presses twice on one place.
    const corners = (open?.corners ?? []).filter((point, i, all) => {
      const before = all[i - 1];
      return (
        !before || Math.hypot(point[0] - before[0], point[1] - before[1]) > 1
      );
    });
    if (corners.length >= 3) {
      apply(
        addMark(historyRef.current, inSelection(shapeMark("polygon", corners))),
      );
    } else {
      redraw();
    }
  };

  const cancelPolygon = () => {
    polygon.current = null;
    setDrawingPolygon(false);
    endFrames();
    redraw();
  };

  /**
   * A change from the controls. A polygon in progress ends with no mark: its
   * frames show the layers as they were before the change.
   */
  const applyControl = (next: SketchHistory) => {
    if (polygon.current) cancelPolygon();
    apply(next);
  };

  // Undo takes back a polygon in progress first, as Escape does.
  const undoStep = () =>
    polygon.current ? cancelPolygon() : apply(undo(historyRef.current));
  const redoStep = () => applyControl(redo(historyRef.current));

  /**
   * Ctrl or Cmd with Z undoes, and with Y or Shift and Z redoes. Not in a text
   * field: there, the keys undo the typing.
   */
  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return;
    event.preventDefault();
    if (key === "y" || event.shiftKey) redoStep();
    else undoStep();
  };

  const discard = async () => {
    const confirmed = await askConfirmation({
      title: t("drawing.discardConfirm"),
      confirmLabel: t("drawing.discard"),
    });
    if (confirmed) closeDrawing();
  };

  /**
   * Closes the pad. It asks first when there is a drawing to lose. False when
   * it stays open to ask. That keeps Back for the pad in the meantime.
   */
  const cancel = (): boolean => {
    // A line that is still in progress is also a drawing to lose.
    commitGesture();
    if (polygon.current) finishPolygon();
    if (!hasStrokes(historyRef.current.present)) {
      closeDrawing();
      return true;
    }
    void discard();
    return false;
  };

  useEscapeStack(true, () => {
    cancel();
  });
  useBackToClose(true, cancel);
  useEscapeStack(selection !== null, () => setSelection(null));
  useEscapeStack(drawingPolygon, cancelPolygon);

  const done = () => {
    const canvas = canvasRef.current;
    if (!canvas || !request || saving) return;
    // Done, pushed with the pen still down, keeps the current line.
    commitGesture();
    if (polygon.current) finishPolygon();
    // Only what shows is the picture. Hidden layers alone change nothing.
    if (!hasVisibleStrokes(historyRef.current.present)) {
      closeDrawing();
      return;
    }
    setSaving(true);
    setFailed(false);
    void encodeDrawing(canvas, base.current !== null).then((blob) => {
      if (!blob) {
        // The pad stays, with the drawing, for a new try. The message is here,
        // because a toast would be under the pad.
        setSaving(false);
        setFailed(true);
        return;
      }
      const name = t("drawing.fileName");
      request.onDone(
        new File(
          [blob],
          blob.type === "image/png" ? name : name.replace(/\.png$/, ".jpg"),
          { type: blob.type },
        ),
      );
      closeDrawing();
    });
  };

  const cropTo = (crop: "image" | "layer") => {
    if (!selection) return;
    apply(
      crop === "image"
        ? cropImage(historyRef.current, selection, wholePaper(paper))
        : cropLayer(historyRef.current, selection),
    );
    setSelection(null);
  };

  const chooseTool = (next: Tool) => {
    if (polygon.current) finishPolygon();
    if (next === "dropper" && tool !== "dropper") toolBefore.current = tool;
    setTool(next);
  };

  /** Where a pointer is on the paper, also past its edge: a drag goes there. */
  const paperPoint = (
    event: { clientX: number; clientY: number },
    shown: DOMRect,
  ): Point => {
    const { x, y, width, height } = currentView();
    return [
      x + ((event.clientX - shown.left) / shown.width) * width,
      y + ((event.clientY - shown.top) / shown.height) * height,
    ];
  };

  /** Where a pointer is on the paper, held at the edge of what shows. */
  const viewPoint = (
    event: { clientX: number; clientY: number },
    shown: DOMRect,
  ): Point => {
    const { x, y, width, height } = currentView();
    const [px, py] = drawingPoint(event, shown, { width, height });
    return [x + px, y + py];
  };

  /** A distance on the screen, in CSS pixels, as pixels of the paper. */
  const onPaper = (pixels: number, shown: DOMRect) =>
    (pixels / shown.width) * currentView().width;

  /**
   * The eye dropper: the ink becomes the color of the drawing where it was
   * pressed, as it shows, with all layers and the image under them. Then the
   * tool from before draws with it.
   */
  const pickColor = (at: Point) => {
    const ctx = context();
    if (!ctx) return;
    const { x, y, width, height } = currentView();
    const [r = 0, g = 0, b = 0] = ctx.getImageData(
      Math.min(width - 1, Math.floor(at[0] - x)),
      Math.min(height - 1, Math.floor(at[1] - y)),
      1,
      1,
    ).data;
    setInk(hex(r, g, b));
    setTool(toolBefore.current);
  };

  /**
   * Flood fill: the area around the press that has the color there, as the
   * drawing shows it, in the ink, on the active layer. Hidden layers do not
   * count, as they do not show.
   */
  const fillAt = (at: Point) => {
    const ctx = context();
    if (!ctx) return;
    const shown = currentView();
    const { data } = ctx.getImageData(0, 0, shown.width, shown.height);
    const found = floodFill(
      data,
      shown.width,
      shown.height,
      at[0] - shown.x,
      at[1] - shown.y,
    );
    if (!found) return;
    const area = growArea(found);
    const image = fillPicture(area, ink);
    if (!image) return;
    const { bounds } = area;
    apply(
      addMark(
        historyRef.current,
        inSelection({
          image,
          at: { ...bounds, x: bounds.x + shown.x, y: bounds.y + shown.y },
          ...(pen.opacity < 1 ? { opacity: pen.opacity } : {}),
        }),
      ),
    );
  };

  /**
   * The move tool: a press on the corner handle of the box of the ink changes
   * its size, and a press at any other place moves it. Nothing happens on an
   * empty layer.
   */
  const startDrag = (pointerId: number, start: Point, shown: DOMRect) => {
    const target: MoveTarget = movingSelection ? "selection" : "layer";
    const layer = activeLayer(historyRef.current.present);
    // A hidden layer does not move: you cannot see what you would move.
    const bounds =
      target === "selection"
        ? selection
        : layer?.visible
          ? layerBounds(layer)
          : null;
    if (!bounds) return;
    // The handle, with some room around it for a finger.
    const reach = onPaper(HANDLE * 1.5, shown);
    const resize =
      Math.abs(start[0] - (bounds.x + bounds.width)) <= reach &&
      Math.abs(start[1] - (bounds.y + bounds.height)) <= reach;
    const drag = {
      kind: "drag" as const,
      pointerId,
      target,
      resize,
      start,
      bounds,
      by: UNCHANGED,
    };
    gesture.current = drag;
    // The area moves alone: the drawing under it does not change.
    if (target === "selection") return;
    cacheAround();
    setDragBy(UNCHANGED);
    paintActive();
  };

  const onPointerDown = (event: PointerEvent) => {
    const canvas = canvasRef.current;
    // One gesture at a time. A second finger, or a palm, is not a second pen.
    if (!canvas || !ready || gesture.current || !event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that the browser does not know now: the gesture still
      // starts. It only stops to follow past the edge of the paper.
    }
    const shown = canvas.getBoundingClientRect();
    const at = viewPoint(event, shown);
    const { pointerId } = event;
    switch (tool) {
      case "dropper":
        pickColor(at);
        return;
      case "fill":
        fillAt(at);
        return;
      case "move":
        startDrag(pointerId, paperPoint(event, shown), shown);
        return;
      case "select":
        gesture.current = { kind: "select", pointerId, start: at };
        setSelection({ x: at[0], y: at[1], width: 0, height: 0 });
        return;
      case "hand": {
        const element = stageRef.current;
        if (!element) return;
        gesture.current = {
          kind: "pan",
          pointerId,
          client: [event.clientX, event.clientY],
          scroll: [element.scrollLeft, element.scrollTop],
        };
        return;
      }
      case "polygon": {
        const open = polygon.current;
        if (!open) {
          polygon.current = { corners: [at], hover: null };
          setDrawingPolygon(true);
          cacheAround();
        } else if (closesPolygon(open.corners, at, onPaper(HANDLE, shown))) {
          finishPolygon();
          return;
        } else {
          open.corners.push(at);
        }
        paintActive();
        return;
      }
      case "line":
        gesture.current = {
          kind: "shape",
          pointerId,
          start: at,
          mark: lineMark([at, at]),
        };
        break;
      case "rect":
      case "ellipse":
        gesture.current = {
          kind: "shape",
          pointerId,
          start: at,
          mark: shapeMark(tool, [at, at]),
        };
        break;
      default:
        gesture.current = { kind: "stroke", pointerId, mark: lineMark([at]) };
    }
    cacheAround();
    paintActive();
    showCursor(event);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.isPrimary) showCursor(event);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const open = polygon.current;
    if (open && !gesture.current) {
      open.hover = viewPoint(event, canvas.getBoundingClientRect());
      schedule();
      return;
    }
    const now = gesture.current;
    if (now?.pointerId !== event.pointerId) return;
    const shown = canvas.getBoundingClientRect();
    switch (now.kind) {
      case "select": {
        const [x, y] = viewPoint(event, shown);
        const [sx, sy] = now.start;
        setSelection({
          x: Math.min(x, sx),
          y: Math.min(y, sy),
          width: Math.abs(x - sx),
          height: Math.abs(y - sy),
        });
        return;
      }
      case "pan": {
        const element = stageRef.current;
        if (!element) return;
        element.scrollLeft = now.scroll[0] - (event.clientX - now.client[0]);
        element.scrollTop = now.scroll[1] - (event.clientY - now.client[1]);
        return;
      }
      case "drag": {
        const to = paperPoint(event, shown);
        const { bounds, start } = now;
        now.by = now.resize
          ? resizeFrom(bounds, [
              to[0] + bounds.x + bounds.width - start[0],
              to[1] + bounds.y + bounds.height - start[1],
            ])
          : { scale: 1, dx: to[0] - start[0], dy: to[1] - start[1] };
        if (now.target === "selection") {
          setSelection(transformRect(bounds, now.by));
          return;
        }
        setDragBy(now.by);
        schedule();
        return;
      }
      case "shape": {
        const to = viewPoint(event, shown);
        // Shift keeps a line at a step of 15 degrees, and a box square.
        const end = !event.shiftKey
          ? to
          : "shape" in now.mark
            ? snapSquare(now.start, to)
            : snapLine(now.start, to);
        now.mark = { ...now.mark, points: [now.start, end] };
        schedule();
        return;
      }
      case "stroke": {
        // Each position through which the pointer went since the last frame,
        // where the browser kept them. If not, a fast hand draws corners.
        const events = event.getCoalescedEvents?.() ?? [];
        for (const each of events.length > 0 ? events : [event]) {
          now.mark.points.push(viewPoint(each, shown));
        }
        schedule();
      }
    }
  };

  const endGesture = (event: PointerEvent) => {
    if (gesture.current?.pointerId === event.pointerId) commitGesture();
    // A finger leaves the screen: there is no place to show the pen at.
    if (event.pointerType === "touch") hideCursor();
  };

  const showCursor = (event: PointerEvent) => {
    const cursor = cursorRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!cursor || !stage || !canvas || !ready) return;
    if (tool !== "pen" && tool !== "eraser" && tool !== "line") {
      hideCursor();
      return;
    }
    placePenCursor(cursor, stage, canvas, event, {
      tip: pen.tip,
      width: strokeWidth(),
      viewWidth: currentView().width,
    });
  };

  const hideCursor = () => {
    if (cursorRef.current) cursorRef.current.style.display = "none";
  };

  const shownLayer = activeLayer(history.present);
  const inkBox = shownLayer?.visible ? layerBounds(shownLayer) : null;
  const layerHasInk = shownLayer !== undefined && hasInk(shownLayer);
  const moveBox = movingSelection
    ? selection
    : inkBox && transformRect(inkBox, dragBy ?? UNCHANGED);
  const canvasCursor =
    tool === "move"
      ? "move"
      : tool === "hand"
        ? "grab"
        : tool === "pen" || tool === "eraser" || tool === "line"
          ? "none"
          : "crosshair";

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("drawing.title")}
      onKeyDown={onKeyDown}
      class={`fixed inset-0 layer-drawing ${padGrid} bg-neutral-900 text-neutral-100 animate-fade-in`}
    >
      <DrawingTopBar
        onCancel={() => void cancel()}
        failed={failed}
        zoomPercent={Math.round((fit ?? 1) * zoom * 100)}
        onZoomOut={() => zoomTo(zoom / ZOOM_STEP)}
        onZoomFit={() => zoomTo(1)}
        onZoomIn={() => zoomTo(zoom * ZOOM_STEP)}
        canZoomOut={zoom > MIN_ZOOM}
        canZoomIn={zoom < MAX_ZOOM}
        onUndo={undoStep}
        onRedo={redoStep}
        canUndo={history.past.length > 0 || drawingPolygon}
        canRedo={history.future.length > 0}
        onClear={() => applyControl(clearLayer(historyRef.current))}
        canClear={layerHasInk}
        onDone={done}
        saving={saving}
      />

      {/* The paper keeps its shape. At zoom 1, it takes what room there is;
          larger, the area scrolls. A margin of auto centres it while it fits,
          and keeps all of it in reach when it does not. */}
      <div
        ref={stageRef}
        class="[grid-area:stage] relative min-h-0 min-w-0 flex overflow-auto p-2"
        onWheel={onWheel}
      >
        <canvas
          ref={canvasRef}
          width={view.width}
          height={view.height}
          class={`m-auto shrink-0 rounded-lg shadow-lg touch-none select-none ${fit === null ? "max-w-full max-h-full" : ""}`}
          style={{
            aspectRatio: `${view.width} / ${view.height}`,
            cursor: canvasCursor,
            ...(fit === null
              ? {}
              : {
                  width: `${view.width * fit * zoom}px`,
                  height: `${view.height * fit * zoom}px`,
                }),
          }}
          aria-label={t("drawing.paper")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onPointerLeave={hideCursor}
          onDblClick={() => {
            if (polygon.current) finishPolygon();
          }}
        />
        {tool === "move" && box && moveBox && (
          <DrawingOverlay box={box} view={view} rect={moveBox} handle />
        )}
        {/* The selected area shows with every tool, as it limits them all. */}
        {box && selection && tool !== "move" && (
          <DrawingOverlay box={box} view={view} rect={selection} />
        )}
        {/* Light and dark rings: it shows over any ink and over a photo. */}
        <div
          ref={cursorRef}
          aria-hidden="true"
          class={`absolute left-0 top-0 hidden pointer-events-none shadow-[0_0_0_1px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.9)] ${erasing ? "border border-dashed border-neutral-500" : ""}`}
          style={
            erasing
              ? undefined
              : {
                  backgroundColor: ink,
                  opacity: Math.max(0.15, pen.opacity * 0.5),
                }
          }
        />
      </div>

      <DrawingHints
        tool={tool}
        selected={selection !== null}
        canCropLayer={layerHasInk}
        onCrop={cropTo}
        onClearSelection={() => setSelection(null)}
      />
      <DrawingToolbar
        tool={tool}
        onTool={chooseTool}
        ink={ink}
        onInk={setInk}
        backInk={backInk}
        onBackInk={setBackInk}
        pen={pen}
        onPen={setPen}
        history={history}
        view={view}
        onHistory={applyControl}
        moveTarget={moveTarget}
        onMoveTarget={setMoveTarget}
        hasSelection={selection !== null}
      />
    </div>
  );
}
