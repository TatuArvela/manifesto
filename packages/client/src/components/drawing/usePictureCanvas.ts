import { useLayoutEffect, useRef } from "preact/hooks";
import type { PaperSize, Rect } from "#/utils/drawing.ts";
import type { SketchHistory } from "#/utils/drawingLayers.ts";
import { renderDrawing } from "#/utils/drawingRender.ts";
import type { CanvasBox } from "./canvasBox.ts";

/**
 * The two canvases of the pad. The picture is at the size of the image: the
 * layers paint it, and Done saves it. The screen shows the picture at the zoom
 * and the place of the view.
 */
export function usePictureCanvas({
  historyRef,
  view,
  currentView,
  paper,
  ready,
  box,
  stage,
  scale,
}: {
  historyRef: { readonly current: SketchHistory };
  view: Rect;
  /** The view as the history has it now, also between two renders. */
  currentView: () => Rect;
  paper: PaperSize;
  ready: boolean;
  box: CanvasBox | null;
  stage: { width: number; height: number } | null;
  scale: number;
}) {
  // The picture, at the size of the image: not shown, but read by the tests.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // What the stage shows of it.
  const screenRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<CanvasBox | null>(box);
  boxRef.current = box;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const context = () => canvasRef.current?.getContext("2d") ?? null;

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
      renderDrawing(ctx, historyRef.current.present.layers, currentView());
    }
    present();
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

  return {
    canvasRef,
    screenRef,
    boxRef,
    scaleRef,
    context,
    present,
    redraw,
  };
}
