import type { RefObject } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import type { Rect } from "#/utils/drawing.ts";

/** Where the canvas is in the area around it, in CSS pixels. */
export interface CanvasBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The box of the canvas, measured again when it changes size: the paper takes
 * what room there is, and a rotated phone gives it a different room.
 */
export function useCanvasBox(
  canvasRef: RefObject<HTMLCanvasElement | null>,
): CanvasBox | null {
  const [box, setBox] = useState<CanvasBox | null>(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () =>
      setBox({
        left: canvas.offsetLeft,
        top: canvas.offsetTop,
        width: canvas.offsetWidth,
        height: canvas.offsetHeight,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef]);
  return box;
}

/** The size of the corner handle of a box on the screen, in CSS pixels. */
export const HANDLE = 14;

/**
 * A dashed box over the paper, at a place on the drawing: the ink of the
 * layer to move, or the area that is selected. With `handle`, a square at its
 * bottom right corner shows where to pull to change the size. It takes no
 * pointer events. The canvas below keeps them, so that one drag works also
 * when it starts outside the box.
 */
export function DrawingOverlay({
  box,
  view,
  rect,
  handle = false,
}: {
  box: CanvasBox;
  /** The part of the paper that the canvas shows. */
  view: Rect;
  rect: Rect;
  handle?: boolean;
}) {
  const sx = box.width / view.width;
  const sy = box.height / view.height;
  return (
    <div
      aria-hidden="true"
      class="absolute pointer-events-none border border-dashed border-blue-400 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
      style={{
        left: `${box.left + (rect.x - view.x) * sx}px`,
        top: `${box.top + (rect.y - view.y) * sy}px`,
        width: `${rect.width * sx}px`,
        height: `${rect.height * sy}px`,
      }}
    >
      {handle && (
        <span
          class="absolute bg-blue-400 ring-1 ring-white"
          style={{
            width: `${HANDLE}px`,
            height: `${HANDLE}px`,
            right: `${-HANDLE / 2}px`,
            bottom: `${-HANDLE / 2}px`,
          }}
        />
      )}
    </div>
  );
}
