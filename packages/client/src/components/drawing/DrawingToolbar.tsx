import {
  Hand,
  History,
  Layers,
  Scaling,
  Shapes,
  SquareDashed,
  ZoomIn,
} from "lucide-preact";
import { Fragment } from "preact";
import { useCallback, useState } from "preact/hooks";
import { t } from "#/i18n/index.ts";
import type { PaperSize, Rect } from "#/utils/drawing.ts";
import type { Anchor, SketchHistory } from "#/utils/drawingLayers.ts";
import type { SelectMode } from "#/utils/selection.ts";
import { DrawingHistory } from "./DrawingHistory.tsx";
import { DrawingColors, InkPair } from "./DrawingInks.tsx";
import { DrawingLayers } from "./DrawingLayers.tsx";
import { DrawingPen } from "./DrawingPen.tsx";
import {
  DrawingSelectOptions,
  type SelectionMove,
} from "./DrawingSelectOptions.tsx";
import { DrawingSize, type ResizeKind } from "./DrawingSize.tsx";
import { hasPenOptions, type PenSettings, tipStyle } from "./pen.ts";
import { barButton, ToolButton, ToolGroup } from "./ToolGroup.tsx";
import { isSelectTool, SELECTIONS, SHAPES, TOOLS, type Tool } from "./tools.ts";

/** A divider between groups: across the bar on a phone, along the rail on a wide screen. */
const divider = "w-px h-6 mx-1 bg-white/20 md:w-6 md:h-px md:mx-0 md:my-1";

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

  const inkPair = (where: string) => (
    <InkPair
      where={where}
      ink={ink}
      onInk={useInk}
      backInk={backInk}
      onBackInk={onBackInk}
      onSwap={() => {
        onInk(backInk);
        onBackInk(ink);
      }}
    />
  );

  return (
    <>
      <div class="[grid-area:inks] relative flex flex-wrap items-center justify-center gap-1 px-2 pt-2 md:w-64 md:flex-col md:flex-nowrap md:items-stretch md:justify-start md:gap-2 md:overflow-y-auto md:p-2 md:pt-0">
        {inkPair("flex md:hidden")}
        <DrawingColors ink={ink} onInk={useInk} onBackInk={onBackInk} />
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
