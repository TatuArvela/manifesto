import { useRef, useState } from "preact/hooks";
import type { Point } from "#/utils/drawing.ts";

/**
 * The polygon tool: each press adds a corner, and a press on the first corner,
 * a double click or another tool closes it. The corners are in a ref, not in
 * the state: the frames read them at each move of the pointer.
 */
export function usePolygonTool({
  endFrames,
  redraw,
  keep,
}: {
  /** The live frames of the corners in progress end. */
  endFrames: () => void;
  /** The canvas shows the drawing as it is. */
  redraw: () => void;
  /** A closed polygon, with three corners or more, to add to the drawing. */
  keep: (corners: Point[]) => void;
}) {
  // The corners of a polygon in progress, and where the pointer is.
  const polygon = useRef<{ corners: Point[]; hover: Point | null } | null>(
    null,
  );
  const [drawing, setDrawing] = useState(false);

  const start = (at: Point) => {
    polygon.current = { corners: [at], hover: null };
    setDrawing(true);
  };

  /** Closes the polygon in progress and keeps it, with three corners or more. */
  const finish = () => {
    const open = polygon.current;
    polygon.current = null;
    setDrawing(false);
    endFrames();
    // A double click presses twice on one place.
    const corners = (open?.corners ?? []).filter((point, i, all) => {
      const before = all[i - 1];
      return (
        !before || Math.hypot(point[0] - before[0], point[1] - before[1]) > 1
      );
    });
    if (corners.length >= 3) keep(corners);
    else redraw();
  };

  const cancel = () => {
    polygon.current = null;
    setDrawing(false);
    endFrames();
    redraw();
  };

  return { polygon, drawing, start, finish, cancel };
}
