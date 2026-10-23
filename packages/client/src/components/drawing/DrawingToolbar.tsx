import { NoteColor } from "@manifesto/shared";
import {
  ArrowLeftRight,
  Circle,
  Eraser,
  Hand,
  Layers,
  Minus,
  Move,
  PaintBucket,
  Pencil,
  Pentagon,
  Pipette,
  Shapes,
  Square,
  SquareDashedMousePointer,
} from "lucide-preact";
import type { ComponentType } from "preact";
import { useState } from "preact/hooks";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { getColorLabel, t } from "#/i18n/index.ts";
import type { SketchHistory } from "#/utils/drawingLayers.ts";
import { DrawingLayers } from "./DrawingLayers.tsx";
import { DrawingPen, type PenSettings, tipStyle } from "./DrawingPen.tsx";

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
  | "select"
  | "move"
  | "hand";

export const INKS = [
  { color: "#171717", name: null },
  { color: "#ffffff", name: "white" },
  { color: "#737373", name: NoteColor.Gray },
  { color: "#dc2626", name: NoteColor.Red },
  { color: "#ea580c", name: NoteColor.Orange },
  { color: "#facc15", name: NoteColor.Yellow },
  { color: "#16a34a", name: NoteColor.Green },
  { color: "#0d9488", name: NoteColor.Teal },
  { color: "#2563eb", name: NoteColor.Blue },
  { color: "#9333ea", name: NoteColor.Purple },
  { color: "#db2777", name: NoteColor.Pink },
  { color: "#92400e", name: NoteColor.Brown },
] as const;

export const barButton =
  "p-2 rounded-lg text-neutral-100 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default";

const SHAPES = [
  { tool: "line", Icon: Minus, label: "drawing.line" },
  { tool: "rect", Icon: Square, label: "drawing.rect" },
  { tool: "ellipse", Icon: Circle, label: "drawing.ellipse" },
  { tool: "polygon", Icon: Pentagon, label: "drawing.polygon" },
] as const;

const TOOLS = [
  { tool: "pen", Icon: Pencil, label: "drawing.penTool" },
  { tool: "eraser", Icon: Eraser, label: "drawing.eraser" },
  { tool: "fill", Icon: PaintBucket, label: "drawing.fill" },
  { tool: "dropper", Icon: Pipette, label: "drawing.dropper" },
] as const;

const VIEW_TOOLS = [
  { tool: "select", Icon: SquareDashedMousePointer, label: "drawing.select" },
  { tool: "move", Icon: Move, label: "drawing.move" },
  { tool: "hand", Icon: Hand, label: "drawing.hand" },
] as const;

const colorField =
  "absolute w-7 h-7 rounded-md cursor-pointer bg-transparent ring-2 ring-neutral-900 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0";

const inkLabel = (name: (typeof INKS)[number]["name"]) =>
  name === null
    ? t("drawing.black")
    : name === "white"
      ? t("drawing.white")
      : getColorLabel(name);

function ToolButton({
  on,
  onClick,
  Icon,
  label,
}: {
  on: boolean;
  onClick: () => void;
  Icon: ComponentType<{ class?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      class={`${barButton} ${on ? "bg-white/20" : ""}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
    >
      <Icon class="w-5 h-5" />
    </button>
  );
}

/** The four shape tools, in a panel. A choice closes it. */
function ShapePicker({
  tool,
  onTool,
  onClose,
}: {
  tool: Tool;
  onTool: (tool: Tool) => void;
  onClose: () => void;
}) {
  useEscapeStack(true, onClose);
  return (
    <fieldset
      class="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 flex gap-1 rounded-lg bg-neutral-800 p-1 shadow-lg ring-1 ring-white/10 border-0 m-0 min-w-0"
      aria-label={t("drawing.shapes")}
    >
      {SHAPES.map(({ tool: each, Icon, label }) => (
        <ToolButton
          key={each}
          on={tool === each}
          onClick={() => {
            onTool(each);
            onClose();
          }}
          Icon={Icon}
          label={t(label)}
        />
      ))}
    </fieldset>
  );
}

/**
 * The bottom bar of the pad: the two inks and the colors to choose them from,
 * the tools, and the panels of the pen and of the layers. A color sets the
 * foreground ink; with a right click, the background ink. Lines, outlines and
 * fills use the foreground ink, and the inside of a shape the background ink.
 */
export function DrawingToolbar({
  tool,
  onTool,
  ink,
  onInk,
  backInk,
  onBackInk,
  pen,
  onPen,
  history,
  onHistory,
}: {
  tool: Tool;
  onTool: (tool: Tool) => void;
  ink: string;
  onInk: (color: string) => void;
  backInk: string;
  onBackInk: (color: string) => void;
  pen: PenSettings;
  onPen: (pen: PenSettings) => void;
  history: SketchHistory;
  onHistory: (next: SketchHistory) => void;
}) {
  const [panel, setPanel] = useState<"pen" | "layers" | "shapes" | null>(null);
  const toggle = (next: "pen" | "layers" | "shapes") =>
    setPanel(panel === next ? null : next);
  const close = () => setPanel(null);
  const shape = SHAPES.find((each) => each.tool === tool) ?? null;
  const ShapeIcon = shape?.Icon ?? Shapes;
  /** A color does not take the place of a tool, except of one with no ink. */
  const useInk = (color: string) => {
    onInk(color);
    if (tool === "eraser" || tool === "dropper") onTool("pen");
  };

  return (
    <div class="relative flex items-center justify-center gap-1 flex-wrap px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {/* The two inks: the foreground over the background. Each one is a color
          field for any other ink, and shows the ink in use. */}
      <span class="relative w-11 h-11 shrink-0">
        <input
          type="color"
          class={`${colorField} left-0 top-0 z-1`}
          value={ink}
          onInput={(event) => useInk(event.currentTarget.value)}
          aria-label={t("drawing.foreground")}
        />
        <input
          type="color"
          class={`${colorField} right-0 bottom-0`}
          value={backInk}
          onInput={(event) => onBackInk(event.currentTarget.value)}
          aria-label={t("drawing.background")}
        />
      </span>
      <button
        type="button"
        class={barButton}
        onClick={() => {
          onInk(backInk);
          onBackInk(ink);
        }}
        aria-label={t("drawing.swapColors")}
      >
        <ArrowLeftRight class="w-4 h-4" />
      </button>
      {INKS.map(({ color, name }) => (
        <button
          key={color}
          type="button"
          class={`w-7 h-7 rounded-full border-2 ring-1 ring-white/30 cursor-pointer ${ink === color ? "border-blue-400" : "border-transparent"}`}
          style={{ backgroundColor: color }}
          onClick={() => useInk(color)}
          onContextMenu={(event) => {
            event.preventDefault();
            onBackInk(color);
          }}
          aria-label={inkLabel(name)}
          aria-pressed={ink === color}
        />
      ))}
      <span class="w-px h-6 mx-1 bg-white/20" aria-hidden="true" />
      {TOOLS.map(({ tool: each, Icon, label }) => (
        <ToolButton
          key={each}
          on={tool === each}
          onClick={() => onTool(tool === each ? "pen" : each)}
          Icon={Icon}
          label={t(label)}
        />
      ))}
      <button
        type="button"
        class={`${barButton} ${shape ? "bg-white/20" : ""}`}
        onClick={() => toggle("shapes")}
        aria-label={t("drawing.shapes")}
        aria-expanded={panel === "shapes"}
      >
        <ShapeIcon class="w-5 h-5" />
      </button>
      {VIEW_TOOLS.map(({ tool: each, Icon, label }) => (
        <ToolButton
          key={each}
          on={tool === each}
          onClick={() => onTool(tool === each ? "pen" : each)}
          Icon={Icon}
          label={t(label)}
        />
      ))}
      <span class="w-px h-6 mx-1 bg-white/20" aria-hidden="true" />
      <button
        type="button"
        class={`${barButton} ${panel === "pen" ? "bg-white/20" : ""}`}
        onClick={() => toggle("pen")}
        aria-label={t("drawing.penSettings")}
        aria-expanded={panel === "pen"}
      >
        <span class="w-5 h-5 flex items-center justify-center">
          <span class="bg-neutral-100" style={tipStyle(pen.tip, 12)} />
        </span>
      </button>
      <button
        type="button"
        class={`${barButton} ${panel === "layers" ? "bg-white/20" : ""}`}
        onClick={() => toggle("layers")}
        aria-label={t("drawing.layers")}
        aria-expanded={panel === "layers"}
      >
        <Layers class="w-5 h-5" />
      </button>
      {panel === "shapes" && (
        <ShapePicker tool={tool} onTool={onTool} onClose={close} />
      )}
      {panel === "pen" && (
        <DrawingPen pen={pen} onChange={onPen} onClose={close} />
      )}
      {panel === "layers" && (
        <DrawingLayers history={history} onChange={onHistory} onClose={close} />
      )}
    </div>
  );
}
