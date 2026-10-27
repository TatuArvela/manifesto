import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { useFocusTrap } from "#/hooks/useFocusTrap.ts";
import { t } from "#/i18n/index.ts";
import { drawingRequest } from "#/state/drawing.ts";
import {
  inkArea,
  type Mark,
  rasterize,
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
  deleteSelected,
  flattenActive,
  hasInk,
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
import { inArea } from "#/utils/selection.ts";
import { DrawingHints } from "./DrawingHints.tsx";
import { BLACK, WHITE } from "./DrawingInks.tsx";
import { type PenSettings, WIDTHS } from "./DrawingPen.tsx";
import { DrawingToolbar } from "./DrawingToolbar.tsx";
import { DrawingTopBar } from "./DrawingTopBar.tsx";
import { type Gesture, UNCHANGED } from "./gesture.ts";
import { PadStage } from "./PadStage.tsx";
import { onPadKey } from "./padKeys.ts";
import { type MarkStyle, shapeMark } from "./penMarks.ts";
import type { Tool } from "./tools.ts";
import { useBaseImage } from "./useBaseImage.ts";
import { useCropTool } from "./useCropTool.ts";
import { useLiveFrames } from "./useLiveFrames.ts";
import { usePadPointer } from "./usePadPointer.ts";
import { usePadSession } from "./usePadSession.ts";
import { usePictureCanvas } from "./usePictureCanvas.ts";
import { usePolygonTool } from "./usePolygonTool.ts";
import { useSelectionTool } from "./useSelectionTool.ts";
import { useViewport } from "./useViewport.ts";

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
  const stageRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<SketchHistory>(newSketchHistory());
  const [history, setHistory] = useState(historyRef.current);
  const gesture = useRef<Gesture | null>(null);
  const polygonTool = usePolygonTool({
    endFrames: () => endFrames(),
    redraw: () => redraw(),
    keep: (corners) =>
      apply(
        addMark(
          historyRef.current,
          inSelection(shapeMark(style(), "polygon", corners)),
        ),
      ),
  });
  const { polygon, drawing: drawingPolygon } = polygonTool;
  // The drag of the move tool as the box over the ink shows it.
  const [dragBy, setDragBy] = useState<Transform | null>(null);
  const [ink, setInk] = useState<string>(BLACK);
  const [backInk, setBackInk] = useState<string>(WHITE);
  const [pen, setPen] = useState<PenSettings>({
    width: WIDTHS[1],
    tip: "round",
    opacity: 1,
    shapes: "outline",
  });
  const [tool, setTool] = useState<Tool>("pen");
  const toolBefore = useRef<Tool>("pen");
  const erasing = tool === "eraser";
  const { base, paper: basePaper, ready } = useBaseImage(request?.base);
  // The paper after a change of the size of the image, or that of the pad.
  const paper = history.present.paper ?? basePaper;
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  /** The part of the paper that the picture shows: all of it, until a crop. */
  const currentView = () =>
    historyRef.current.present.frame ?? wholePaper(paper);
  const view = history.present.frame ?? wholePaper(paper);
  const viewport = useViewport(stageRef, view);
  const { zoom, scale, box, stage, zoomTo, onWheel } = viewport;

  // The image to draw over, as the bottom layer, once it is read. Before the
  // first paint of the canvas, which reads the history.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as the image arrives
  useLayoutEffect(() => {
    const image = base.current;
    if (!ready || !image) return;
    const next = newSketchHistory({
      image,
      paper: basePaper,
      name: t("drawing.pictureLayer"),
    });
    historyRef.current = next;
    setHistory(next);
  }, [ready]);

  const picture = usePictureCanvas({
    historyRef,
    view,
    currentView,
    paper,
    ready,
    box,
    stage,
    scale,
  });
  const { canvasRef, context, present, redraw } = picture;

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
      return [inSelection(shapeMark(style(), "polygon", corners))];
    }
    return [];
  };

  const { paintActive, schedule, cacheAround, endFrames } = useLiveFrames({
    context,
    sketch: () => historyRef.current.present,
    view: currentView,
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

  const style = (): MarkStyle => ({ pen, ink, backInk, erasing, paper });

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

  const finishPolygon = polygonTool.finish;
  const cancelPolygon = polygonTool.cancel;

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

  const { cancel, done, saving, failed } = usePadSession({
    onDone: request?.onDone,
    canvasRef,
    overImage: () => base.current !== null,
    historyRef,
    endInput: () => {
      commitGesture();
      selectTool.end();
      if (polygon.current) finishPolygon();
    },
  });
  useEscapeStack(selection !== null, () => setSelection(null));
  useEscapeStack(drawingPolygon, cancelPolygon);
  useEscapeStack(selectTool.tracing, selectTool.cancelTrace);
  useEscapeStack(cropTool.area !== null, cropTool.clear);

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

  const pointer = usePadPointer({
    screenRef: picture.screenRef,
    stageRef,
    cursorRef,
    dialogRef,
    boxRef: picture.boxRef,
    scaleRef: picture.scaleRef,
    historyRef,
    gesture,
    ready,
    tool,
    toolBefore,
    setTool,
    ink,
    setInk,
    pen,
    style,
    inkBox,
    setDragBy,
    viewport,
    polygonTool,
    selectTool,
    cropTool,
    context,
    currentView,
    apply,
    flatten,
    inSelection,
    commitGesture,
    cacheAround,
    paintActive,
    schedule,
  });

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("drawing.title")}
      tabIndex={-1}
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
          deleteSelected: () => {
            if (!selection) return false;
            flatten();
            apply(
              deleteSelected(
                historyRef.current,
                selection.bounds,
                selection.mask,
              ),
            );
            return true;
          },
          deselect: () => setSelection(null),
          invert: selectTool.invert,
          undo: undoStep,
          redo: redoStep,
        })
      }
      class={`fixed inset-0 layer-drawing outline-none ${padGrid} bg-neutral-900 text-neutral-100 animate-fade-in select-none [&_input]:select-text`}
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

      <PadStage
        stageRef={stageRef}
        canvasRef={canvasRef}
        screenRef={picture.screenRef}
        cursorRef={cursorRef}
        view={view}
        box={box}
        stage={stage}
        tool={tool}
        ink={ink}
        pen={pen}
        moveBox={moveBox}
        selection={selection}
        selectTool={selectTool}
        cropArea={cropTool.area}
        onWheel={onWheel}
        onPointerDown={pointer.onPointerDown}
        onPointerMove={pointer.onPointerMove}
        onPointerEnd={pointer.endGesture}
        onPointerLeave={pointer.hideCursor}
        onDblClick={() => {
          if (polygon.current) finishPolygon();
          selectTool.finishTrace();
        }}
      />

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
