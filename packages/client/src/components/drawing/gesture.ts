import type { Point, Rect, Shape, Stroke, Transform } from "#/utils/drawing.ts";

/** What the pointer that is down is doing on the pad. One at a time. */
export type Gesture =
  | { kind: "stroke"; pointerId: number; mark: Stroke }
  | { kind: "shape"; pointerId: number; start: Point; mark: Stroke | Shape }
  | {
      kind: "drag";
      pointerId: number;
      resize: boolean;
      start: Point;
      bounds: Rect;
      by: Transform;
    }
  | { kind: "select"; pointerId: number; start: Point }
  | {
      kind: "pan";
      pointerId: number;
      client: Point;
      scroll: Point;
    };

/** No change of size or place. */
export const UNCHANGED: Transform = { scale: 1, dx: 0, dy: 0 };
