import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { useBackToClose } from "#/hooks/useBackToClose.ts";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { useFocusTrap } from "#/hooks/useFocusTrap.ts";
import { t } from "#/i18n/index.ts";
import { askConfirmation } from "#/state/confirm.ts";
import { closeDrawing, drawingRequest } from "#/state/drawing.ts";
import {
  CORNERS,
  cornerPoint,
  encodeDrawing,
  inkArea,
  type Mark,
  PAPER,
  type Point,
  penScale,
  type Rect,
  rasterize,
  renderDrawing,
  resizeAround,
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
  flattenActive,
  hasInk,
  hasStrokes,
  hasVisibleStrokes,
  layerBounds,
  moveSelected,
  newSketchHistory,
  redo,
  resizeCanvas,
  resizeImage,
  type SketchHistory,
  transformLayer,
  undo,
} from "#/utils/drawingLayers.ts";
import { fillPicture, floodFill, growArea } from "#/utils/floodFill.ts";
import { inArea } from "#/utils/selection.ts";
import { closesPolygon, snapLine, snapSquare } from "#/utils/shapes.ts";
import { DrawingHints } from "./DrawingHints.tsx";
import {
  type CanvasBox,
  DrawingOverlay,
  HANDLE,
  SelectionDraft,
  SelectionOutline,
} from "./DrawingOverlay.tsx";
import { type PenSettings, WIDTHS } from "./DrawingPen.tsx";
import { DrawingToolbar, INKS, type Tool } from "./DrawingToolbar.tsx";
import { DrawingTopBar } from "./DrawingTopBar.tsx";
import { type Gesture, UNCHANGED } from "./gesture.ts";
import { onPadKey } from "./padKeys.ts";
import { placePenCursor } from "./penCursor.ts";
import { useBaseImage } from "./useBaseImage.ts";
import { useCropTool } from "./useCropTool.ts";
import { useLiveFrames } from "./useLiveFrames.ts";
import { useSelectionTool } from "./useSelectionTool.ts";
import { useViewport } from "./useViewport.ts";

/** The eraser is wider than the pen, wide enough to rub with. */
const ERASER_SCALE = 4;

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
 * Two canvases: the picture, at the size of the image, which the layers paint
 * and Done saves, and the screen, which shows it at the zoom and the place of
 * the view, with a margin around the paper. A layer goes past the edge of the
 * paper, and the tools work in the margin too.
 *
 * The drawing has layers, and each change is a step that undo takes back and
 * redo does again. All of it is for this session: Done flattens what shows into
 * one picture.
 */
export function DrawingPad() {
  const request = drawingRequest.value;
  // The picture, at the size of the image: not shown, but read by the tests.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // What the stage shows of it.
  const screenRef = useRef<HTMLCanvasElement>(null);
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
  const { base, paper: basePaper, ready } = useBaseImage(request?.base);
  // The paper after a change of the size of the image, or that of the pad.
  const paper = history.present.paper ?? basePaper;
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  const context = () => canvasRef.current?.getContext("2d") ?? null;

  /** The part of the paper that the picture shows: all of it, until a crop. */
  const currentView = () =>
    historyRef.current.present.frame ?? wholePaper(paper);
  const view = history.present.frame ?? wholePaper(paper);
  const viewport = useViewport(stageRef, view);
  const { zoom, scale, box, stage, zoomTo, onWheel } = viewport;
  const boxRef = useRef<CanvasBox | null>(box);
  boxRef.current = box;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  /**
   * The picture on the screen, at the place and the zoom of the view. Its
   * pixels show as squares from twice their size: you see what you edit.
   */
  const present = () => {
    const screen = screenRef.current;
    const picture = canvasRef.current;
    const at = boxRef.current;
    const ctx = screen?.getContext("2d");
    if (!screen || !picture || !at || !ctx || !stage) return;
    const ratio = screen.width / stage.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, screen.width, screen.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingEnabled = scaleRef.current < 2;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(picture, at.left, at.top, at.width, at.height);
  };

  // A new place or zoom of the view, or a new size of the stage.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on each new view of the picture
  useLayoutEffect(present, [
    box?.left,
    box?.top,
    box?.width,
    box?.height,
    stage?.width,
    stage?.height,
  ]);

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
    present();
  };

  /**
   * The ink of the active layer as one picture, before a change of its
   * pixels. The picture on the screen stays the same, and so does the undo.
   */
  const flatten = () => {
    const next = flattenActive(historyRef.current, (marks) =>
      rasterize(marks, inkArea(paper)),
    );
    historyRef.current = next;
    setHistory(next);
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
    selection ? inArea(mark, selection) : mark;

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
    present,
    floating: () => {
      const offset = selectTool.pixelOffset();
      if (!offset || !selection) return null;
      return { bounds: selection.bounds, mask: selection.mask, offset };
    },
  });

  const selectTool = useSelectionTool({
    view: currentView,
    onMovePixels: (area, dx, dy) =>
      apply(moveSelected(historyRef.current, area.bounds, area.mask, dx, dy)),
    onPixelFrames: (phase) => {
      if (phase === "start") {
        flatten();
        cacheAround();
        paintActive();
      } else if (phase === "frame") {
        schedule();
      } else {
        endFrames();
        redraw();
      }
    },
  });
  const { selection, setSelection } = selectTool;
  const cropTool = useCropTool((area) =>
    apply(cropImage(historyRef.current, area, wholePaper(paper))),
  );

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
    if (now.kind === "pan") return;
    endFrames();
    if (now.kind === "drag") {
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
    selectTool.end();
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
  useEscapeStack(selectTool.tracing, selectTool.cancelTrace);
  useEscapeStack(cropTool.area !== null, cropTool.clear);

  const done = () => {
    const canvas = canvasRef.current;
    if (!canvas || !request || saving) return;
    // Done, pushed with the pen still down, keeps the current line.
    commitGesture();
    selectTool.end();
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
    if (crop === "layer") flatten();
    apply(
      crop === "image"
        ? cropImage(historyRef.current, selection.bounds, wholePaper(paper))
        : cropLayer(historyRef.current, selection.bounds, selection.mask),
    );
    setSelection(null);
  };

  const chooseTool = (next: Tool) => {
    if (polygon.current) finishPolygon();
    selectTool.cancelTrace();
    cropTool.clear();
    if (next === "dropper" && tool !== "dropper") toolBefore.current = tool;
    setTool(next);
  };

  /** Where the paper is on the screen, in client pixels. */
  const shownPaper = (): CanvasBox | null => {
    const at = boxRef.current;
    const element = stageRef.current;
    if (!at || !element) return null;
    const around = element.getBoundingClientRect();
    return { ...at, left: around.left + at.left, top: around.top + at.top };
  };

  /** Where a pointer is on the paper, also past its edge: a layer goes there. */
  const paperPoint = (
    event: { clientX: number; clientY: number },
    shown: CanvasBox,
  ): Point => {
    const { x, y, width, height } = currentView();
    return [
      x + ((event.clientX - shown.left) / shown.width) * width,
      y + ((event.clientY - shown.top) / shown.height) * height,
    ];
  };

  /** True when a point is on the picture, not in the margin around it. */
  const onPicture = ([px, py]: Point) => {
    const { x, y, width, height } = currentView();
    return px >= x && py >= y && px < x + width && py < y + height;
  };

  /** A distance on the screen, in CSS pixels, as pixels of the paper. */
  const onPaper = (pixels: number, shown: CanvasBox) =>
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
  /** The corner handle at a point of the paper, with room for a finger. */
  const cornerAt = (bounds: Rect, at: Point, shown: CanvasBox) => {
    const reach = onPaper(HANDLE * 1.5, shown);
    return (
      CORNERS.find((corner) => {
        const [x, y] = cornerPoint(bounds, corner);
        return Math.abs(at[0] - x) <= reach && Math.abs(at[1] - y) <= reach;
      }) ?? null
    );
  };

  const startDrag = (pointerId: number, start: Point, shown: CanvasBox) => {
    // A hidden layer does not move: you cannot see what you would move.
    if (!activeLayer(historyRef.current.present)?.visible) return;
    flatten();
    const layer = activeLayer(historyRef.current.present);
    const bounds = layer ? layerBounds(layer) : null;
    if (!bounds) return;
    const corner = cornerAt(bounds, start, shown);
    cacheAround();
    gesture.current = {
      kind: "drag",
      pointerId,
      corner,
      start,
      bounds,
      by: UNCHANGED,
    };
    setDragBy(UNCHANGED);
    paintActive();
  };

  const onPointerDown = (event: PointerEvent) => {
    const canvas = screenRef.current;
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
    const shown = shownPaper();
    if (!shown) return;
    const at = paperPoint(event, shown);
    const { pointerId } = event;
    switch (tool) {
      case "dropper":
        if (onPicture(at)) pickColor(at);
        return;
      case "fill":
        if (onPicture(at)) fillAt(at);
        return;
      case "move":
        startDrag(pointerId, at, shown);
        return;
      case "select":
      case "selectEllipse":
      case "lasso":
      case "polyLasso":
        selectTool.begin(tool, pointerId, at, event, onPaper(HANDLE, shown));
        return;
      case "crop":
        cropTool.begin(pointerId, at);
        return;
      case "zoom":
        // A click zooms in at the pointer, and with Alt, out.
        zoomTo(
          event.altKey ? zoom / viewport.ZOOM_STEP : zoom * viewport.ZOOM_STEP,
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
    const canvas = screenRef.current;
    const shown = shownPaper();
    if (!canvas || !shown) return;
    const open = polygon.current;
    if (open && !gesture.current) {
      open.hover = paperPoint(event, shown);
      schedule();
      return;
    }
    if (tool === "move" && !gesture.current && inkBox) {
      // The pointer shows when a press would change the size.
      const corner = cornerAt(inkBox, paperPoint(event, shown), shown);
      canvas.style.cursor =
        corner === null
          ? "move"
          : corner === "nw" || corner === "se"
            ? "nwse-resize"
            : "nesw-resize";
    }
    if (selectTool.tracing) {
      selectTool.hover(paperPoint(event, shown));
      return;
    }
    if (selectTool.dragging(event.pointerId)) {
      selectTool.update(paperPoint(event, shown));
      return;
    }
    if (cropTool.dragging(event.pointerId)) {
      cropTool.update(paperPoint(event, shown));
      return;
    }
    const now = gesture.current;
    if (now?.pointerId !== event.pointerId) return;
    switch (now.kind) {
      case "pan":
        viewport.panTo([
          now.center[0] - (event.clientX - now.client[0]) / scale,
          now.center[1] - (event.clientY - now.client[1]) / scale,
        ]);
        return;
      case "drag": {
        const to = paperPoint(event, shown);
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
        setDragBy(now.by);
        schedule();
        return;
      }
      case "shape": {
        const to = paperPoint(event, shown);
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
          now.mark.points.push(paperPoint(each, shown));
        }
        schedule();
      }
    }
  };

  const endGesture = (event: PointerEvent) => {
    if (gesture.current?.pointerId === event.pointerId) commitGesture();
    if (selectTool.dragging(event.pointerId)) selectTool.end();
    if (cropTool.dragging(event.pointerId)) cropTool.end();
    // A finger leaves the screen: there is no place to show the pen at.
    if (event.pointerType === "touch") hideCursor();
  };

  const showCursor = (event: PointerEvent) => {
    const cursor = cursorRef.current;
    const element = stageRef.current;
    if (!cursor || !element || !ready) return;
    if (tool !== "pen" && tool !== "eraser" && tool !== "line") {
      hideCursor();
      return;
    }
    placePenCursor(cursor, element, event, {
      tip: pen.tip,
      width: strokeWidth(),
      scale: scaleRef.current,
    });
  };

  const hideCursor = () => {
    if (cursorRef.current) cursorRef.current.style.display = "none";
  };

  const shownLayer = activeLayer(history.present);
  // Measured again only when the layer changes, not at each move of a drag.
  const inkBox = useMemo(
    () => (shownLayer?.visible ? layerBounds(shownLayer) : null),
    [shownLayer],
  );
  const layerHasInk = useMemo(
    () => shownLayer !== undefined && hasInk(shownLayer),
    [shownLayer],
  );
  const moveBox = inkBox && transformRect(inkBox, dragBy ?? UNCHANGED);
  const pixelRatio = window.devicePixelRatio || 1;
  const canvasCursor =
    tool === "move"
      ? "move"
      : tool === "hand"
        ? "grab"
        : tool === "zoom"
          ? "zoom-in"
          : tool === "pen" || tool === "eraser" || tool === "line"
            ? "none"
            : "crosshair";

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("drawing.title")}
      onKeyDown={(event) =>
        onPadKey(event, {
          tool,
          chooseTool,
          applyCrop: () => {
            if (!cropTool.area) return false;
            cropTool.apply();
            return true;
          },
          selectAll: selectTool.selectAll,
          deselect: () => setSelection(null),
          invert: selectTool.invert,
          undo: undoStep,
          redo: redoStep,
        })
      }
      class={`fixed inset-0 layer-drawing ${padGrid} bg-neutral-900 text-neutral-100 animate-fade-in select-none [&_input]:select-text`}
    >
      <DrawingTopBar
        onCancel={() => void cancel()}
        failed={failed}
        zoomPercent={Math.round(scale * 100)}
        onZoomOut={() => zoomTo(zoom / viewport.ZOOM_STEP)}
        onZoomFit={viewport.fitView}
        onZoomPercent={(percent) => zoomTo(percent / 100 / (scale / zoom))}
        onZoomIn={() => zoomTo(zoom * viewport.ZOOM_STEP)}
        canZoomOut={zoom > viewport.MIN_ZOOM}
        canZoomIn={zoom < viewport.MAX_ZOOM}
        onUndo={undoStep}
        onRedo={redoStep}
        canUndo={history.past.length > 0 || drawingPolygon}
        canRedo={history.future.length > 0}
        onClear={() => applyControl(clearLayer(historyRef.current))}
        canClear={layerHasInk}
        onDone={done}
        saving={saving}
      />

      {/* The stage is the screen: the paper at the place and the zoom of
          the view, and a margin around it. The sheet under the screen gives
          the paper its shadow, and its place to the tests. */}
      <div
        ref={stageRef}
        class="[grid-area:stage] relative min-h-0 min-w-0 overflow-hidden"
        onWheel={onWheel}
      >
        <canvas
          ref={canvasRef}
          width={view.width}
          height={view.height}
          hidden
        />
        {box && (
          <div
            data-paper
            aria-hidden="true"
            class="absolute bg-white shadow-lg pointer-events-none"
            style={{
              left: `${box.left}px`,
              top: `${box.top}px`,
              width: `${box.width}px`,
              height: `${box.height}px`,
            }}
          />
        )}
        <canvas
          ref={screenRef}
          width={Math.max(1, Math.round((stage?.width ?? 1) * pixelRatio))}
          height={Math.max(1, Math.round((stage?.height ?? 1) * pixelRatio))}
          class="absolute inset-0 size-full touch-none select-none"
          style={{ cursor: canvasCursor }}
          aria-label={t("drawing.paper")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onPointerLeave={hideCursor}
          onDblClick={() => {
            if (polygon.current) finishPolygon();
            selectTool.finishTrace();
          }}
        />
        {tool === "move" && box && moveBox && (
          <DrawingOverlay box={box} view={view} rect={moveBox} handle />
        )}
        {/* The selected area shows with every tool, as it limits them all. */}
        {box && selection && tool !== "move" && (
          <SelectionOutline
            box={box}
            view={view}
            selection={selection}
            offset={selectTool.offset}
          />
        )}
        {box && cropTool.area && (
          <DrawingOverlay box={box} view={view} rect={cropTool.area} dim />
        )}
        {box && selectTool.draft && (
          <SelectionDraft box={box} view={view} shape={selectTool.draft} />
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
        cropping={cropTool.area !== null}
        onApplyCrop={cropTool.apply}
        onCancelCrop={cropTool.clear}
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
        selectMode={selectTool.mode}
        onSelectMode={selectTool.setMode}
        selectionMove={selectTool.move}
        onSelectionMove={selectTool.setMove}
        onResize={(kind, width, height, anchor) => {
          setSelection(null);
          applyControl(
            kind === "canvas"
              ? resizeCanvas(
                  historyRef.current,
                  basePaper,
                  width,
                  height,
                  anchor,
                )
              : resizeImage(historyRef.current, basePaper, width, height),
          );
        }}
      />
    </div>
  );
}
