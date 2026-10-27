import { useEffect, useRef } from "preact/hooks";
import {
  blankCanvas,
  CPU_INK,
  drawMarks,
  type Mark,
  type Point,
  paintLayer,
  type Rect,
  renderDrawing,
  reusedCanvas,
  type Transform,
} from "#/utils/drawing.ts";
import { activeLayer, type Sketch } from "#/utils/drawingLayers.ts";

/** What the frames of a gesture read, each time that they paint. */
export interface LiveSource {
  context: () => CanvasRenderingContext2D | null;
  sketch: () => Sketch;
  /** The part of the paper that the picture shows. */
  view: () => Rect;
  /** While the move tool drags the active layer: how far it moved it. */
  moving: () => Transform | null;
  /** Marks that the frame shows on the active layer, not yet in the sketch. */
  preview: () => Mark[];
  /** Shows the picture on the screen, after a frame changed it. */
  present: () => void;
  /**
   * While a drag moves the ink of a selected area: the area, and how far the
   * ink moved.
   */
  floating: () => {
    bounds: Rect;
    mask: CanvasImageSource;
    offset: Point;
  } | null;
}

/**
 * The frames of a gesture. At its start, `cacheAround` keeps the picture under
 * the active layer, that layer alone, and the picture over it. Then each frame
 * paints only the change in progress between them. The canvases stay for the
 * next gesture while the view keeps its size: a canvas of a large photo holds
 * tens of megabytes.
 */
export function useLiveFrames(source: LiveSource) {
  const live = useRef<{
    under: HTMLCanvasElement;
    layer: HTMLCanvasElement;
    over: HTMLCanvasElement;
    scratch: HTMLCanvasElement;
  } | null>(null);
  const kept = useRef<typeof live.current>(null);
  // For a move of the ink of an area: the layer without it, and the ink itself.
  const floatingInk = useRef<{
    rest: HTMLCanvasElement;
    piece: HTMLCanvasElement;
  } | null>(null);
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /**
   * The change in progress over the drawing under it, one time in each frame.
   * If the code drew a line on top of itself at each move, its soft edge would
   * become solid, and the line would become thinner at the release.
   */
  const paintActive = () => {
    frame.current = 0;
    const ctx = source.context();
    const canvases = live.current;
    if (!ctx || !canvases) return;
    const { under, layer, over, scratch } = canvases;
    const scratchCtx = scratch.getContext("2d", CPU_INK);
    if (!scratchCtx) return;
    scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
    const { x, y } = source.view();
    const by = source.moving();
    const floating = source.floating();
    const cut = floatingInk.current;
    if (floating && cut) {
      // Two pictures made at the start: each frame only puts the ink at its
      // new place, whatever the number of marks on the layer.
      const { bounds, offset } = floating;
      scratchCtx.drawImage(cut.rest, 0, 0);
      scratchCtx.drawImage(
        cut.piece,
        bounds.x - x + offset[0],
        bounds.y - y + offset[1],
      );
    } else if (by) {
      // The layer as a picture while it moves: the same picture that the
      // release moves, because the drag made the layer one. The cached layer starts
      // at the corner of the view, not of the paper.
      const { scale, dx, dy } = by;
      scratchCtx.setTransform(
        scale,
        0,
        0,
        scale,
        x * scale + dx - x,
        y * scale + dy - y,
      );
      scratchCtx.drawImage(layer, 0, 0);
    } else {
      scratchCtx.drawImage(layer, 0, 0);
      scratchCtx.setTransform(1, 0, 0, 1, -x, -y);
      drawMarks(scratchCtx, source.preview());
    }
    scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(under, 0, 0);
    ctx.globalAlpha = activeLayer(source.sketch())?.opacity ?? 1;
    ctx.drawImage(scratch, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(over, 0, 0);
    source.present();
  };

  const schedule = () => {
    frame.current ||= requestAnimationFrame(paintActive);
  };

  /**
   * The picture under the active layer, that layer alone, and the picture over
   * it, for the frames of a gesture.
   */
  const cacheAround = () => {
    const { layers, active } = source.sketch();
    const index = layers.findIndex((layer) => layer.id === active);
    const shown = source.view();
    const reused = kept.current;
    const under = reusedCanvas(reused?.under, shown);
    const over = reusedCanvas(reused?.over, shown);
    const layer = reusedCanvas(reused?.layer, shown);
    const underCtx = under.getContext("2d");
    const overCtx = over.getContext("2d");
    if (underCtx) {
      const below = layers.slice(0, index);
      renderDrawing(underCtx, below, shown);
    }
    if (overCtx) {
      renderDrawing(overCtx, layers.slice(index + 1), shown, true);
    }
    paintLayer(layer, layers[index]?.marks ?? [], shown);
    const scratch = reusedCanvas(reused?.scratch, shown);
    live.current = kept.current = { under, layer, over, scratch };
    floatingInk.current = null;
    const floating = source.floating();
    if (floating) floatingInk.current = cutOut(layer, shown, floating);
  };

  const endFrames = () => {
    live.current = null;
    floatingInk.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  };

  return { paintActive, schedule, cacheAround, endFrames };
}

/**
 * The cached layer as two pictures: without the ink in an area, and that ink
 * alone, in the box of the area.
 */
function cutOut(
  layer: HTMLCanvasElement,
  view: Rect,
  area: { bounds: Rect; mask: CanvasImageSource },
) {
  const { bounds, mask } = area;
  const rest = blankCanvas(view);
  const piece = blankCanvas(bounds);
  const restCtx = rest.getContext("2d");
  const pieceCtx = piece.getContext("2d");
  if (!restCtx || !pieceCtx) return null;
  const at = { x: bounds.x - view.x, y: bounds.y - view.y };
  restCtx.drawImage(layer, 0, 0);
  restCtx.globalCompositeOperation = "destination-out";
  restCtx.drawImage(mask, at.x, at.y, bounds.width, bounds.height);
  pieceCtx.drawImage(layer, -at.x, -at.y);
  pieceCtx.globalCompositeOperation = "destination-in";
  pieceCtx.drawImage(mask, 0, 0, bounds.width, bounds.height);
  return { rest, piece };
}
