import { NoteColor } from "@manifesto/shared";
import {
  Circle,
  CircleDashed,
  Crop,
  Eraser,
  Hand,
  History,
  Lasso,
  Layers,
  Minus,
  Move,
  PaintBucket,
  Pencil,
  Pentagon,
  Pipette,
  Repeat2,
  Scaling,
  Shapes,
  Square,
  SquareDashed,
  VectorPolygon,
  ZoomIn,
} from "lucide-preact";
import { type ComponentType, Fragment, type RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { Tooltip } from "#/components/Tooltip.tsx";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { getColorLabel, t } from "#/i18n/index.ts";
import type { PaperSize, Rect } from "#/utils/drawing.ts";
import type { Anchor, SketchHistory } from "#/utils/drawingLayers.ts";
import type { SelectMode } from "#/utils/selection.ts";
import { DrawingHistory } from "./DrawingHistory.tsx";
import { DrawingLayers } from "./DrawingLayers.tsx";
import {
  DrawingPen,
  hasPenOptions,
  type PenSettings,
  tipStyle,
} from "./DrawingPen.tsx";
import {
  DrawingSelectOptions,
  type SelectionMove,
} from "./DrawingSelectOptions.tsx";
import { DrawingSize, type ResizeKind } from "./DrawingSize.tsx";
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

/**
 * The tools that select an area, in a menu of one button. A key picks the
 * first tool of its letter, and again the next one.
 */
const SELECTIONS = [
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

const SHAPES = [
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
const TOOLS = [
  { tool: "move", Icon: Move, label: "drawing.move" },
  { tool: "crop", Icon: Crop, label: "drawing.crop", key: "C" },
  { tool: "dropper", Icon: Pipette, label: "drawing.dropper" },
  { tool: "pen", Icon: Pencil, label: "drawing.penTool" },
  { tool: "eraser", Icon: Eraser, label: "drawing.eraser" },
  { tool: "fill", Icon: PaintBucket, label: "drawing.fill" },
] as const;

// A round ink with a light ring and a dark gap: a black ink shows on the dark
// bar, and the two inks stay apart where they overlap. The browser gives a
// color field a border and padding of its own, with square corners behind the
// round swatch. Thus, both are removed.
const colorField =
  "absolute w-8 h-8 appearance-none overflow-hidden rounded-full border-0 p-0 cursor-pointer bg-transparent shadow-[0_0_0_2px_#737373,0_0_0_4px_#171717] [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0";

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
  shortcut,
}: {
  on: boolean;
  onClick: () => void;
  Icon: ComponentType<{ class?: string }>;
  label: string;
  /** The key that picks the tool, shown after the name in the tooltip. */
  shortcut?: string | undefined;
}) {
  return (
    <Tooltip label={shortcut ? `${label} (${shortcut})` : label}>
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

type ToolItem = (typeof SHAPES | typeof SELECTIONS)[number];

/**
 * A button for a group of tools, with the icon of the tool of the group in
 * use, and the menu of the group that it opens. A choice, Escape or a press
 * outside the menu closes it.
 */
function ToolGroup({
  label,
  items,
  Fallback,
  tool,
  open,
  onToggle,
  onTool,
  onClose,
}: {
  label: string;
  items: readonly ToolItem[];
  /** The icon while no tool of the group is in use. */
  Fallback: ComponentType<{ class?: string }>;
  tool: Tool;
  open: boolean;
  onToggle: () => void;
  onTool: (tool: Tool) => void;
  onClose: () => void;
}) {
  const area = useRef<HTMLSpanElement>(null);
  const current = items.find((each) => each.tool === tool);
  const Icon = current?.Icon ?? Fallback;
  return (
    <span class="relative" ref={area}>
      <Tooltip label={label}>
        <button
          type="button"
          class={current ? toolOn : barButton}
          onClick={onToggle}
          aria-label={label}
          aria-expanded={open}
        >
          <Icon class="w-5 h-5" />
        </button>
      </Tooltip>
      {open && (
        <ToolMenu
          label={label}
          items={items}
          tool={tool}
          within={area}
          onTool={onTool}
          onClose={onClose}
        />
      )}
    </span>
  );
}

function ToolMenu({
  label,
  items,
  tool,
  within,
  onTool,
  onClose,
}: {
  label: string;
  items: readonly ToolItem[];
  tool: Tool;
  /** The menu with its button. A press anywhere else closes the menu. */
  within: RefObject<HTMLElement | null>;
  onTool: (tool: Tool) => void;
  onClose: () => void;
}) {
  useEscapeStack(true, onClose);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const area = within.current;
      if (area && !area.contains(event.target as Node)) onClose();
    };
    // Capture: the canvas takes its pointer events, and they do not bubble.
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [within, onClose]);
  return (
    <fieldset
      class="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 flex gap-1 rounded-lg bg-neutral-800 p-1 shadow-lg ring-1 ring-white/10 border-0 m-0 min-w-0 md:left-full md:top-0 md:bottom-auto md:translate-x-0 md:mb-0 md:ml-2"
      aria-label={label}
    >
      {items.map((item) => (
        <ToolButton
          key={item.tool}
          on={tool === item.tool}
          onClick={() => {
            onTool(item.tool);
            onClose();
          }}
          Icon={item.Icon}
          label={t(item.label)}
          shortcut={"key" in item ? item.key : undefined}
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
  selectMode,
  onSelectMode,
  selectionMove,
  onSelectionMove,
  onResize,
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
  selectMode: SelectMode;
  onSelectMode: (next: SelectMode) => void;
  selectionMove: SelectionMove;
  onSelectionMove: (next: SelectionMove) => void;
  onResize: (
    kind: ResizeKind,
    width: number,
    height: number,
    anchor: Anchor,
  ) => void;
}) {
  type Panel = "pen" | "layers" | "shapes" | "selections" | "size" | "history";
  const [panel, setPanel] = useState<Panel | null>(null);
  const toggle = (next: Panel) => setPanel(panel === next ? null : next);
  const close = useCallback(() => setPanel(null), []);
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
    <span class={`${where} relative w-12 h-12 shrink-0`}>
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
      <span class="absolute right-0 top-0">
        <Tooltip label={t("drawing.swapColors")}>
          <button
            type="button"
            class="relative flex items-center justify-center w-4 h-4 rounded-sm text-neutral-300 hover:text-white cursor-pointer after:absolute after:-inset-1"
            onClick={() => {
              onInk(backInk);
              onBackInk(ink);
            }}
            aria-label={t("drawing.swapColors")}
          >
            <Repeat2 class="w-4 h-4" />
          </button>
        </Tooltip>
      </span>
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
        <DrawingHistory
          open={panel === "history"}
          history={history}
          onChange={onHistory}
          onClose={close}
        />
        <DrawingSize
          open={panel === "size"}
          size={view satisfies PaperSize}
          onResize={onResize}
          onClose={close}
        />
      </div>

      <div class="[grid-area:options] relative md:flex md:items-center md:justify-center md:px-2">
        {isSelectTool(tool) ? (
          <DrawingSelectOptions
            mode={selectMode}
            onMode={onSelectMode}
            move={selectionMove}
            onMove={onSelectionMove}
            open={panel === "pen"}
            onClose={close}
          />
        ) : (
          <DrawingPen
            tool={tool}
            pen={pen}
            open={panel === "pen"}
            onChange={onPen}
            onClose={close}
          />
        )}
      </div>

      <div class="[grid-area:tools] flex flex-wrap items-center justify-center gap-1 px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:flex-col md:flex-nowrap md:justify-start md:p-2 md:pt-0">
        {TOOLS.map((item) => (
          <Fragment key={item.tool}>
            <ToolButton
              on={tool === item.tool}
              onClick={() => onTool(tool === item.tool ? "pen" : item.tool)}
              Icon={item.Icon}
              label={t(item.label)}
              shortcut={"key" in item ? item.key : undefined}
            />
            {item.tool === "move" && (
              <ToolGroup
                label={t("drawing.selection")}
                items={SELECTIONS}
                Fallback={SquareDashed}
                tool={tool}
                open={panel === "selections"}
                onToggle={() => toggle("selections")}
                onTool={onTool}
                onClose={close}
              />
            )}
          </Fragment>
        ))}
        <ToolGroup
          label={t("drawing.shapes")}
          items={SHAPES}
          Fallback={Shapes}
          tool={tool}
          open={panel === "shapes"}
          onToggle={() => toggle("shapes")}
          onTool={onTool}
          onClose={close}
        />
        <ToolButton
          on={tool === "hand"}
          onClick={() => onTool(tool === "hand" ? "pen" : "hand")}
          Icon={Hand}
          label={t("drawing.hand")}
        />
        <ToolButton
          on={tool === "zoom"}
          onClick={() => onTool(tool === "zoom" ? "pen" : "zoom")}
          Icon={ZoomIn}
          label={t("drawing.zoomTool")}
          shortcut="Z"
        />
        <span class={divider} aria-hidden="true" />
        {inkPair("hidden md:flex")}
        {/* On a wide screen, the options are over the paper and the layers
            at its right, always there. */}
        <button
          type="button"
          class={`${barButton} md:hidden ${panel === "pen" ? "bg-white/20" : ""}`}
          onClick={() => toggle("pen")}
          disabled={!isSelectTool(tool) && !hasPenOptions(tool)}
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
        <button
          type="button"
          class={`${barButton} md:hidden ${panel === "size" ? "bg-white/20" : ""}`}
          onClick={() => toggle("size")}
          aria-label={t("drawing.pictureSize")}
          aria-expanded={panel === "size"}
        >
          <Scaling class="w-5 h-5" />
        </button>
        <button
          type="button"
          class={`${barButton} md:hidden ${panel === "history" ? "bg-white/20" : ""}`}
          onClick={() => toggle("history")}
          aria-label={t("drawing.history")}
          aria-expanded={panel === "history"}
        >
          <History class="w-5 h-5" />
        </button>
      </div>
    </>
  );
}
