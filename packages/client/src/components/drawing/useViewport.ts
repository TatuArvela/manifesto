import type { RefObject } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import type { PaperSize, Point, Rect } from "#/utils/drawing.ts";
import type { CanvasBox } from "./DrawingOverlay.tsx";

/** Zoom, as a part of the size that fits the screen. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 16;
const ZOOM_STEP = 1.25;

/**
 * The room around the paper at the zoom that fits, in CSS pixels. Thus, the
 * handles at the edge of the paper are in reach, and you see where it ends.
 */
const MARGIN = 32;

const middle = (view: Rect): Point => [
  view.x + view.width / 2,
  view.y + view.height / 2,
];

/**
 * The view of the picture in the stage: a zoom, and the point of the picture
 * at the middle of the stage. The stage is the screen, not the picture. It
 * shows a margin around the paper, and a tool works there too. At zoom 1, the
 * paper takes all the room there is, less the margin (`fit`, in CSS pixels for
 * each pixel of the picture).
 */
export function useViewport(
  stageRef: RefObject<HTMLDivElement | null>,
  view: Rect,
) {
  const [stage, setStage] = useState<PaperSize | null>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<Point>(() => middle(view));

  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const measure = () =>
      setStage({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [stageRef]);

  // A new paper, or a crop: the view fits it again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on each new view
  useLayoutEffect(() => {
    setZoom(1);
    setCenter(middle(view));
  }, [view.x, view.y, view.width, view.height]);

  const fit = stage
    ? Math.max(
        0.01,
        Math.min(
          (stage.width - MARGIN * 2) / view.width,
          (stage.height - MARGIN * 2) / view.height,
        ),
      )
    : null;
  const scale = (fit ?? 1) * zoom;

  /** Where the paper is in the stage, in CSS pixels. */
  const box: CanvasBox | null = stage && {
    left: stage.width / 2 + (view.x - center[0]) * scale,
    top: stage.height / 2 + (view.y - center[1]) * scale,
    width: view.width * scale,
    height: view.height * scale,
  };

  /** The middle of the stage stays over the paper: it cannot get lost. */
  const held = ([x, y]: Point): Point => [
    Math.min(view.x + view.width, Math.max(view.x, x)),
    Math.min(view.y + view.height, Math.max(view.y, y)),
  ];

  const panTo = (next: Point) => setCenter(held(next));

  /**
   * A new zoom that keeps the point of the picture at `at` (a place on the
   * screen) in place, or the middle of the stage.
   */
  const zoomTo = (next: number, at?: Point) => {
    const element = stageRef.current;
    const value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (!element || !stage || fit === null || value === zoom) return;
    if (at) {
      const around = element.getBoundingClientRect();
      const ox = at[0] - around.left - stage.width / 2;
      const oy = at[1] - around.top - stage.height / 2;
      const after = fit * value;
      setCenter(
        held([
          center[0] + ox / scale - ox / after,
          center[1] + oy / scale - oy / after,
        ]),
      );
    }
    setZoom(value);
  };

  const fitView = () => {
    setZoom(1);
    setCenter(middle(view));
  };

  /**
   * Ctrl or Cmd with the wheel zooms at the pointer, as on a map. The wheel
   * alone moves the view.
   */
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      zoomTo(zoom * Math.exp(-event.deltaY / 300), [
        event.clientX,
        event.clientY,
      ]);
      return;
    }
    const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
    const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
    setCenter((now) => held([now[0] + dx / scale, now[1] + dy / scale]));
  };

  return {
    stage,
    zoom,
    fit,
    scale,
    box,
    center,
    panTo,
    zoomTo,
    fitView,
    onWheel,
    MIN_ZOOM,
    MAX_ZOOM,
    ZOOM_STEP,
  };
}
