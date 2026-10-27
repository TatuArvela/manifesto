import { useLayoutEffect, useRef } from "preact/hooks";
import { CORNERS, type Point, type Rect } from "#/utils/drawing.ts";
import type { Selection, SelectShape } from "#/utils/selection.ts";

/** Where the paper is in the stage, in CSS pixels from its corner. */
export interface CanvasBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The size of a corner handle of a box on the screen, in CSS pixels. */
export const HANDLE = 12;

/**
 * A dashed box over the paper, at a place on the drawing: the ink of the
 * layer to move, or the area that is selected. With `handle`, a square at each
 * corner shows where to pull to change the size. It takes no
 * pointer events. The canvas below keeps them, so that one drag works also
 * when it starts outside the box. With `dim`, the paper outside the box is
 * darker: the part that a crop removes.
 */
export function DrawingOverlay({
  box,
  view,
  rect,
  handle = false,
  dim = false,
}: {
  box: CanvasBox;
  /** The part of the paper that the canvas shows. */
  view: Rect;
  rect: Rect;
  handle?: boolean;
  dim?: boolean;
}) {
  const sx = box.width / view.width;
  const sy = box.height / view.height;
  return (
    <div
      aria-hidden="true"
      class={`absolute pointer-events-none border border-dashed border-blue-400 ${dim ? "shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_0_0_100vmax_rgba(0,0,0,0.45)]" : "shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"}`}
      style={{
        left: `${box.left + (rect.x - view.x) * sx}px`,
        top: `${box.top + (rect.y - view.y) * sy}px`,
        width: `${rect.width * sx}px`,
        height: `${rect.height * sy}px`,
      }}
    >
      {handle &&
        CORNERS.map((corner) => (
          <span
            key={corner}
            class="absolute rounded-xs bg-white border-2 border-blue-500 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
            style={{
              width: `${HANDLE}px`,
              height: `${HANDLE}px`,
              [corner.endsWith("w") ? "left" : "right"]: `${-HANDLE / 2 - 1}px`,
              [corner.startsWith("n") ? "top" : "bottom"]:
                `${-HANDLE / 2 - 1}px`,
            }}
          />
        ))}
    </div>
  );
}

/**
 * The edge of the selected area, as black and white dashes: it shows over any
 * ink and over a photo. Drawn at the size of the screen, so that the line is
 * one pixel wide at any zoom. `offset` moves it while a drag moves the area,
 * without a new drawing for each frame.
 */
export function SelectionOutline({
  box,
  view,
  selection,
  offset,
}: {
  box: CanvasBox;
  view: Rect;
  selection: Selection;
  /** How far a drag moved the area, in pixels of the paper. */
  offset: Point;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(box.width * ratio));
  const height = Math.max(1, Math.round(box.height * ratio));
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const sx = width / view.width;
    const sy = height / view.height;
    const { bounds, mask } = selection;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(
      mask,
      (bounds.x - view.x) * sx,
      (bounds.y - view.y) * sy,
      bounds.width * sx,
      bounds.height * sy,
    );
    // Only the box of the area, with one pixel around it, can have an edge.
    const left = Math.max(0, Math.floor((bounds.x - view.x) * sx) - 1);
    const top = Math.max(0, Math.floor((bounds.y - view.y) * sy) - 1);
    const right = Math.min(
      width,
      Math.ceil((bounds.x + bounds.width - view.x) * sx) + 1,
    );
    const bottom = Math.min(
      height,
      Math.ceil((bounds.y + bounds.height - view.y) * sy) + 1,
    );
    const w = right - left;
    const h = bottom - top;
    if (w <= 0 || h <= 0) return;
    const shown = ctx.getImageData(left, top, w, h);
    const inside = (x: number, y: number) =>
      x >= 0 &&
      y >= 0 &&
      x < w &&
      y < h &&
      (shown.data[(y * w + x) * 4 + 3] ?? 0) >= 128;
    const edge = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const here = inside(x, y);
        if (
          here === inside(x + 1, y) &&
          here === inside(x - 1, y) &&
          here === inside(x, y + 1) &&
          here === inside(x, y - 1)
        ) {
          continue;
        }
        if (!here) continue;
        const v = ((x + left + y + top) >> 2) & 1 ? 255 : 0;
        const p = (y * w + x) * 4;
        edge.data[p] = v;
        edge.data[p + 1] = v;
        edge.data[p + 2] = v;
        edge.data[p + 3] = 255;
      }
    }
    ctx.clearRect(0, 0, width, height);
    ctx.putImageData(edge, left, top);
  }, [selection, view.x, view.y, view.width, view.height, width, height]);
  const sx = box.width / view.width;
  const sy = box.height / view.height;
  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      class="absolute pointer-events-none"
      style={{
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        transform: `translate(${offset[0] * sx}px, ${offset[1] * sy}px)`,
      }}
    />
  );
}

/** An ellipse in a box, as two half arcs of an SVG path. */
function ellipsePath({ x, y, width, height }: Rect): string {
  const rx = width / 2;
  const ry = height / 2;
  const cy = y + ry;
  return `M${x} ${cy}a${rx} ${ry} 0 1 0 ${width} 0a${rx} ${ry} 0 1 0 ${-width} 0z`;
}

/** A shape that a selection tool draws, while the drag lasts. */
export function SelectionDraft({
  box,
  view,
  shape,
}: {
  box: CanvasBox;
  view: Rect;
  shape: SelectShape;
}) {
  const d =
    shape.kind === "rect"
      ? `M${shape.rect.x} ${shape.rect.y}h${shape.rect.width}v${shape.rect.height}h${-shape.rect.width}z`
      : shape.kind === "ellipse"
        ? ellipsePath(shape.rect)
        : `M${shape.points.map(([x, y]) => `${x} ${y}`).join("L")}z`;
  return (
    <svg
      aria-hidden="true"
      class="absolute pointer-events-none overflow-visible"
      style={{
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      }}
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      preserveAspectRatio="none"
    >
      <path
        d={d}
        fill="none"
        stroke="#000"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
      <path
        d={d}
        fill="none"
        stroke="#fff"
        stroke-width="1"
        stroke-dasharray="4 4"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  );
}
