import { useRef, useState } from "preact/hooks";
import type { Point, Rect } from "#/utils/drawing.ts";

/** A drag shorter than this, in paper pixels, is a tap, not an area. */
const MIN_CROP = 4;

/**
 * The box of the crop tool. A drag draws the part of the picture to keep, and
 * a new drag draws it again. The box stays until Crop (or Enter) keeps only
 * that part, or until Escape, the close button or a tap removes it.
 */
export function useCropTool(onCrop: (area: Rect) => void) {
  const [area, setArea] = useState<Rect | null>(null);
  const drag = useRef<{ pointerId: number; start: Point } | null>(null);

  const begin = (pointerId: number, at: Point) => {
    drag.current = { pointerId, start: at };
    setArea({ x: at[0], y: at[1], width: 0, height: 0 });
  };

  const update = (at: Point) => {
    const now = drag.current;
    if (!now) return;
    const [sx, sy] = now.start;
    setArea({
      x: Math.min(at[0], sx),
      y: Math.min(at[1], sy),
      width: Math.abs(at[0] - sx),
      height: Math.abs(at[1] - sy),
    });
  };

  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    if (area && area.width < MIN_CROP && area.height < MIN_CROP) {
      setArea(null);
    }
  };

  const apply = () => {
    if (!area) return;
    onCrop(area);
    setArea(null);
  };

  return {
    area,
    clear: () => setArea(null),
    begin,
    update,
    end,
    apply,
    dragging: (pointerId: number) => drag.current?.pointerId === pointerId,
  };
}
