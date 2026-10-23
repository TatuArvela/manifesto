import type { RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { PaperSize, Point, Rect } from "#/utils/drawing.ts";

/** Zoom, as a part of the size that fits the screen. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 16;
const ZOOM_STEP = 1.25;

/**
 * The zoom of the paper in the area around it. At zoom 1, the paper takes all
 * the room there is (`fit`, in CSS pixels for each pixel of the paper). A zoom
 * keeps the point of the paper under the pointer, or under the middle of the
 * area, in place.
 */
export function useStageZoom(
  stageRef: RefObject<HTMLDivElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  view: Rect,
) {
  const [stage, setStage] = useState<PaperSize | null>(null);
  const [zoom, setZoom] = useState(1);
  // The point of the paper to keep under the anchor through a zoom: a part of
  // the width and the height, and a place on the screen.
  const anchor = useRef<{ fx: number; fy: number; at: Point } | null>(null);

  // The room for the paper, inside the padding of the area.
  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      setStage({
        width:
          element.clientWidth -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight),
        height:
          element.clientHeight -
          Number.parseFloat(style.paddingTop) -
          Number.parseFloat(style.paddingBottom),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [stageRef]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: on each new zoom
  useLayoutEffect(() => {
    const kept = anchor.current;
    const element = stageRef.current;
    const canvas = canvasRef.current;
    anchor.current = null;
    if (!kept || !element || !canvas) return;
    const shown = canvas.getBoundingClientRect();
    element.scrollLeft += shown.left + kept.fx * shown.width - kept.at[0];
    element.scrollTop += shown.top + kept.fy * shown.height - kept.at[1];
  }, [zoom]);

  const fit = stage
    ? Math.max(
        0.01,
        Math.min(stage.width / view.width, stage.height / view.height),
      )
    : null;

  /** A new zoom that keeps the point at `at` on the screen in place. */
  const zoomTo = (next: number, at?: Point) => {
    const canvas = canvasRef.current;
    const element = stageRef.current;
    const value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (!canvas || !element || value === zoom) return;
    const shown = canvas.getBoundingClientRect();
    const around = element.getBoundingClientRect();
    const point: Point = at ?? [
      around.left + around.width / 2,
      around.top + around.height / 2,
    ];
    anchor.current = {
      fx: (point[0] - shown.left) / shown.width,
      fy: (point[1] - shown.top) / shown.height,
      at: point,
    };
    setZoom(value);
  };

  /** Ctrl or Cmd with the wheel zooms at the pointer, as on a map. */
  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoomTo(zoom * Math.exp(-event.deltaY / 300), [
      event.clientX,
      event.clientY,
    ]);
  };

  return { zoom, fit, zoomTo, onWheel, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP };
}
