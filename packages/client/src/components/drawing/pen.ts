import type { PenTip } from "#/utils/drawing.ts";
import type { Tool } from "./tools.ts";

/** Pen widths, in pixels of the paper. */
export const WIDTHS = [4, 10, 22] as const;
export const MIN_WIDTH = 1;
export const MAX_WIDTH = 200;

export interface PenSettings {
  width: number;
  tip: PenTip;
  /** From 0 to 1. */
  opacity: number;
  /** What a shape draws: its outline, its inside, or both. */
  shapes: ShapeStyle;
}

export type ShapeStyle = "outline" | "filled" | "both";

/** The look of a tip on its button, as the paper shows it. */
export function tipStyle(tip: PenTip, size: number) {
  return {
    width: `${size}px`,
    height: `${tip === "oval" ? size * 0.35 : size}px`,
    borderRadius: tip === "square" ? "0" : "9999px",
    transform: tip === "oval" ? "rotate(-45deg)" : undefined,
  };
}

/** The options that apply to a tool. A tool with none shows no panel. */
export function penOptions(tool: Tool) {
  const shape = tool === "rect" || tool === "ellipse" || tool === "polygon";
  const lines = tool === "pen" || tool === "eraser" || tool === "line" || shape;
  return {
    tip: lines,
    size: lines,
    opacity: lines && tool !== "eraser" ? true : tool === "fill",
    shapes: shape,
  };
}

export const hasPenOptions = (tool: Tool) =>
  Object.values(penOptions(tool)).some(Boolean);
