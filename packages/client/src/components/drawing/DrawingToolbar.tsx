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
import { Tooltip } from "#/components/Tooltip.tsx";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { getColorLabel, t } from "#/i18n/index.ts";
import type { Rect } from "#/utils/drawing.ts";
import type { SketchHistory } from "#/utils/drawingLayers.ts";
import { DrawingLayers } from "./DrawingLayers.tsx";
import {
  DrawingPen,
  hasPenOptions,
  type PenSettings,
  tipStyle,
} from "./DrawingPen.tsx";

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

/**
 * The tools in the order of most picture editors: those that pick a part of
 * the drawing, then those that put ink on it. The shapes come after these, and
 * the hand that moves the view is last.
 */
const TOOLS = [
  { tool: "move", Icon: Move, label: "drawing.move" },
  { tool: "select", Icon: SquareDashedMousePointer, label: "drawing.select" },
  { tool: "dropper", Icon: Pipette, label: "drawing.dropper" },
  { tool: "pen", Icon: Pencil, label: "drawing.penTool" },
  { tool: "eraser", Icon: Eraser, label: "drawing.eraser" },
  { tool: "fill", Icon: PaintBucket, label: "drawing.fill" },
] as const;

const colorField =
  "absolute w-7 h-7 rounded-md cursor-pointer bg-transparent ring-2 ring-neutral-900 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0";

const inkLabel = (name: (typeof INKS)[number]["name"]) =>
  name === null
    ? t("drawing.black")
    : name === "white"
      ? t("drawing.white")
      : getColorLabel(name);

const toolOn =
  "p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 cursor-pointer";

/** A divider between groups: across the bar on a phone, along the rail on a wide screen. */
const divider = "w-px h-6 mx-1 bg-white/20 md:w-6 md:h-px md:mx-0 md:my-1";

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
    <Tooltip label={label}>
      <button
        type="button"
        class={on ? toolOn : barButton}
        onClick={onClick}
        aria-label={label}
        aria-pressed={on}
      >
        <Icon class="w-5 h-5" />
      </button>
    </Tooltip>
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
      class="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 flex gap-1 rounded-lg bg-neutral-800 p-1 shadow-lg ring-1 ring-white/10 border-0 m-0 min-w-0 md:left-full md:top-0 md:bottom-auto md:translate-x-0 md:mb-0 md:ml-2"
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
 * The controls around the paper, as three areas of the grid of the pad: the
 * inks, the options of the current tool, and the tools. On a phone, they are
 * rows under the paper. On a wide screen, the tools are a rail at the left,
 * the inks a rail at the right, and the options a bar over the paper.
 *
 * A color sets the foreground ink; with a right click, the background ink.
 * Lines, outlines and fills use the foreground ink, and the inside of a shape
 * the background ink.
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
  view,
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
  /** The part of the paper that the picture shows, for the layer pictures. */
  view: Rect;
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

  /**
   * The two inks: the foreground over the background, and the button that
   * swaps them. Each ink is a color field for any other ink, and shows the ink
   * in use. On a phone in the row of colors, on a wide screen under the tools.
   */
  const inkPair = (where: string) => (
    <span class={`${where} items-center gap-1 md:flex-col`}>
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
      <Tooltip label={t("drawing.swapColors")}>
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
      </Tooltip>
    </span>
  );

  return (
    <>
      <div class="[grid-area:inks] relative flex flex-wrap items-center justify-center gap-1 px-2 pt-2 md:w-64 md:flex-col md:flex-nowrap md:items-stretch md:justify-start md:gap-2 md:overflow-y-auto md:p-2 md:pt-0">
        {inkPair("flex md:hidden")}
        <section class="md:rounded-lg md:bg-neutral-800 md:p-2">
          <h2 class="hidden md:block px-1 pb-2 text-xs font-medium text-neutral-400">
            {t("drawing.colors")}
          </h2>
          <div class="flex flex-wrap justify-center gap-0.5 md:grid md:grid-cols-6 md:justify-items-center md:gap-2">
            {INKS.map(({ color, name }) => (
              <button
                key={color}
                type="button"
                class={`w-6 h-6 md:w-7 md:h-7 rounded-full cursor-pointer ${ink === color ? "ring-2 ring-blue-400 ring-offset-2 ring-offset-neutral-900 md:ring-offset-neutral-800" : "ring-1 ring-white/30"}`}
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
          </div>
        </section>
        <DrawingLayers
          open={panel === "layers"}
          history={history}
          view={view}
          onChange={onHistory}
          onClose={close}
        />
      </div>

      <div class="[grid-area:options] relative md:px-2 md:pb-2">
        <DrawingPen
          tool={tool}
          pen={pen}
          open={panel === "pen"}
          onChange={onPen}
          onClose={close}
        />
      </div>

      <div class="[grid-area:tools] flex flex-wrap items-center justify-center gap-1 px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:flex-col md:flex-nowrap md:justify-start md:p-2 md:pt-0">
        {TOOLS.map(({ tool: each, Icon, label }) => (
          <ToolButton
            key={each}
            on={tool === each}
            onClick={() => onTool(tool === each ? "pen" : each)}
            Icon={Icon}
            label={t(label)}
          />
        ))}
        <span class="relative">
          <Tooltip label={t("drawing.shapes")}>
            <button
              type="button"
              class={shape ? toolOn : barButton}
              onClick={() => toggle("shapes")}
              aria-label={t("drawing.shapes")}
              aria-expanded={panel === "shapes"}
            >
              <ShapeIcon class="w-5 h-5" />
            </button>
          </Tooltip>
          {panel === "shapes" && (
            <ShapePicker tool={tool} onTool={onTool} onClose={close} />
          )}
        </span>
        <ToolButton
          on={tool === "hand"}
          onClick={() => onTool(tool === "hand" ? "pen" : "hand")}
          Icon={Hand}
          label={t("drawing.hand")}
        />
        <span class={divider} aria-hidden="true" />
        {inkPair("hidden md:flex")}
        {/* On a wide screen, the options are over the paper and the layers
            at its right, always there. */}
        <button
          type="button"
          class={`${barButton} md:hidden ${panel === "pen" ? "bg-white/20" : ""}`}
          onClick={() => toggle("pen")}
          disabled={!hasPenOptions(tool)}
          aria-label={t("drawing.penSettings")}
          aria-expanded={panel === "pen"}
        >
          <span class="w-5 h-5 flex items-center justify-center">
            <span class="bg-neutral-100" style={tipStyle(pen.tip, 12)} />
          </span>
        </button>
        <button
          type="button"
          class={`${barButton} md:hidden ${panel === "layers" ? "bg-white/20" : ""}`}
          onClick={() => toggle("layers")}
          aria-label={t("drawing.layers")}
          aria-expanded={panel === "layers"}
        >
          <Layers class="w-5 h-5" />
        </button>
      </div>
    </>
  );
}
