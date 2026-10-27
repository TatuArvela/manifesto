import {
  PAPER,
  type PaperSize,
  type Point,
  type Shape,
  type Stroke,
} from "#/utils/drawing.ts";
import type { PenSettings } from "./DrawingPen.tsx";

/** The eraser is wider than the pen, wide enough to rub with. */
const ERASER_SCALE = 4;

/** What a new mark takes from the controls of the pad. */
export type MarkStyle = {
  pen: PenSettings;
  ink: string;
  backInk: string;
  erasing: boolean;
  paper: PaperSize;
};

/** The width of the pen, the eraser or an outline, in pixels of the paper. */
export const strokeWidth = ({ pen, erasing }: MarkStyle) =>
  erasing ? pen.width * ERASER_SCALE : pen.width;

export const shapeMark = (
  style: MarkStyle,
  kind: Shape["shape"],
  points: Point[],
): Shape => ({
  shape: kind,
  points,
  width: strokeWidth(style),
  ...(style.pen.shapes === "filled" ? {} : { color: style.ink }),
  ...(style.pen.shapes === "outline" ? {} : { fill: style.backInk }),
  ...(style.pen.opacity < 1 ? { opacity: style.pen.opacity } : {}),
});

export const lineMark = (style: MarkStyle, points: Point[]): Stroke => ({
  color: style.erasing ? PAPER : style.ink,
  width: strokeWidth(style),
  points,
  ...(style.erasing ? { erase: true } : {}),
  ...(style.pen.tip === "round" ? {} : { tip: style.pen.tip }),
  ...(style.pen.opacity < 1 ? { opacity: style.pen.opacity } : {}),
});
