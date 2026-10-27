import {
  Circle,
  CircleDashed,
  Crop,
  Eraser,
  Lasso,
  Minus,
  Move,
  PaintBucket,
  Pencil,
  Pentagon,
  Pipette,
  Square,
  SquareDashed,
  VectorPolygon,
} from "lucide-preact";
import type { SelectTool } from "./useSelectionTool.ts";

/** What a press on the paper does. */
export type Tool =
  | "pen"
  | "eraser"
  | "line"
  | "rect"
  | "ellipse"
  | "polygon"
  | "fill"
  | "dropper"
  | SelectTool
  | "crop"
  | "move"
  | "hand"
  | "zoom";

/**
 * The tools that select an area, in a menu of one button. A key picks the
 * first tool of its letter, and again the next one.
 */
export const SELECTIONS = [
  { tool: "select", Icon: SquareDashed, label: "drawing.select", key: "M" },
  {
    tool: "selectEllipse",
    Icon: CircleDashed,
    label: "drawing.selectEllipse",
    key: "M",
  },
  { tool: "lasso", Icon: Lasso, label: "drawing.lasso", key: "L" },
  {
    tool: "polyLasso",
    Icon: VectorPolygon,
    label: "drawing.polyLasso",
    key: "L",
  },
] as const;

export const isSelectTool = (tool: Tool): tool is SelectTool =>
  SELECTIONS.some((each) => each.tool === tool);

/**
 * The tool that a key picks after `tool`, or null. C picks Crop, and Z Zoom. A key of the
 * selection tools picks the next tool of its letter.
 */
export function toolForKey(tool: Tool, key: string): Tool | null {
  if (key.toLowerCase() === "c") return "crop";
  if (key.toLowerCase() === "z") return "zoom";
  const group = SELECTIONS.filter((each) => each.key === key.toUpperCase());
  const at = group.findIndex((each) => each.tool === tool);
  return group[(at + 1) % group.length]?.tool ?? null;
}

export const SHAPES = [
  { tool: "line", Icon: Minus, label: "drawing.line" },
  { tool: "rect", Icon: Square, label: "drawing.rect" },
  { tool: "ellipse", Icon: Circle, label: "drawing.ellipse" },
  { tool: "polygon", Icon: Pentagon, label: "drawing.polygon" },
] as const;

/**
 * The tools in the order of most picture editors: those that pick a part of
 * the drawing, the crop, then those that put ink on it. The shapes come after these, and
 * the hand that moves the view and the zoom are last.
 */
export const TOOLS = [
  { tool: "move", Icon: Move, label: "drawing.move" },
  { tool: "crop", Icon: Crop, label: "drawing.crop", key: "C" },
  { tool: "dropper", Icon: Pipette, label: "drawing.dropper" },
  { tool: "pen", Icon: Pencil, label: "drawing.penTool" },
  { tool: "eraser", Icon: Eraser, label: "drawing.eraser" },
  { tool: "fill", Icon: PaintBucket, label: "drawing.fill" },
] as const;

/** True for the tools that show the shape of the pen at the pointer. */
export const showsPen = (tool: Tool) =>
  tool === "pen" || tool === "eraser" || tool === "line";

/** The pointer over the paper for each tool. */
export const toolCursor = (tool: Tool) =>
  tool === "move"
    ? "move"
    : tool === "hand"
      ? "grab"
      : tool === "zoom"
        ? "zoom-in"
        : showsPen(tool)
          ? "none"
          : "crosshair";
