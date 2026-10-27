import { Eye, PencilRuler, PenLine, SquarePen } from "lucide-preact";
import type { ComponentType } from "preact";
import { Tooltip } from "#/components/Tooltip.tsx";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { t } from "#/i18n/index.ts";
import type { PenTip } from "#/utils/drawing.ts";
import type { Tool } from "./tools.ts";

/** Pen widths, in pixels of the paper. */
export const WIDTHS = [4, 10, 22] as const;
export const MIN_WIDTH = 1;
export const MAX_WIDTH = 200;

const TIPS = [
  { tip: "round", label: "drawing.tipRound" },
  { tip: "square", label: "drawing.tipSquare" },
  { tip: "oval", label: "drawing.tipOval" },
] as const;

export interface PenSettings {
  width: number;
  tip: PenTip;
  /** From 0 to 1. */
  opacity: number;
  /** What a shape draws: its outline, its inside, or both. */
  shapes: ShapeStyle;
}

export type ShapeStyle = "outline" | "filled" | "both";

const SHAPE_STYLES = [
  { style: "outline", label: "drawing.shapeOutline" },
  { style: "filled", label: "drawing.shapeFilled" },
  { style: "both", label: "drawing.shapeBoth" },
] as const;

/** The look of a tip on its button, as the paper shows it. */
export function tipStyle(tip: PenTip, size: number) {
  return {
    width: `${size}px`,
    height: `${tip === "oval" ? size * 0.35 : size}px`,
    borderRadius: tip === "square" ? "0" : "9999px",
    transform: tip === "oval" ? "rotate(-45deg)" : undefined,
  };
}

/**
 * The panel of the options of a tool: on a wide screen a bar over the paper,
 * always there; on a phone a panel that the pen button opens.
 */
export const optionsPanel = (open: boolean) =>
  `${open ? "flex" : "hidden"} absolute left-1/2 -translate-x-1/2 bottom-full mb-1 w-64 max-w-[calc(100vw-1rem)] flex-col gap-2 rounded-lg bg-neutral-800 p-2 shadow-lg ring-1 ring-white/10 border-0 m-0 min-w-0 text-sm md:static md:flex md:translate-x-0 md:w-auto md:max-w-none md:flex-row md:flex-wrap md:items-center md:justify-center md:gap-x-6 md:gap-y-1 md:bg-transparent md:p-0 md:shadow-none md:ring-0`;

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

/**
 * The name of an option: an icon, with the name on hover. In the panel of a
 * phone, there is room for the name as text too.
 */
function OptionName({
  Icon,
  name,
}: {
  Icon: ComponentType<{ class?: string }>;
  name: string;
}) {
  return (
    <span class="flex-1 flex items-center gap-2 md:flex-none md:pr-1">
      <Tooltip label={name}>
        <Icon class="w-4 h-4 text-neutral-400" />
      </Tooltip>
      <span class="md:sr-only">{name}</span>
    </span>
  );
}

const choice = (on: boolean) =>
  `w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer ${on ? "bg-white/20" : "hover:bg-white/10"}`;

/**
 * The shape, width and transparency of the pen, also for the eraser, lines
 * and the outlines of shapes, and what a shape draws. The width has three sizes to
 * press, and a field for any other, in pixels of the paper. Thus, a width
 * is the same number of pixels on paper of any size.
 *
 * Only the options of the current tool show. On a wide screen they are a bar
 * over the paper, always there. On a phone they are a panel that the pen
 * button of the bottom bar opens.
 */
export function DrawingPen({
  tool,
  pen,
  open,
  onChange,
  onClose,
}: {
  tool: Tool;
  pen: PenSettings;
  open: boolean;
  onChange: (next: PenSettings) => void;
  onClose: () => void;
}) {
  useEscapeStack(open, onClose);
  const shows = penOptions(tool);
  if (!hasPenOptions(tool)) return null;

  return (
    <fieldset class={optionsPanel(open)} aria-label={t("drawing.penSettings")}>
      {shows.tip && (
        <div class="flex items-center gap-1">
          <OptionName Icon={PenLine} name={t("drawing.tip")} />
          {TIPS.map(({ tip, label }) => (
            <button
              key={tip}
              type="button"
              class={choice(pen.tip === tip)}
              onClick={() => onChange({ ...pen, tip })}
              aria-label={t(label)}
              aria-pressed={pen.tip === tip}
            >
              <span class="bg-neutral-100" style={tipStyle(tip, 14)} />
            </button>
          ))}
        </div>
      )}
      {shows.size && (
        <div class="flex items-center gap-1">
          <OptionName Icon={PencilRuler} name={t("drawing.size")} />
          {WIDTHS.map((each, i) => (
            <button
              key={each}
              type="button"
              class={choice(pen.width === each)}
              onClick={() => onChange({ ...pen, width: each })}
              aria-label={t("drawing.width", { n: i + 1 })}
              aria-pressed={pen.width === each}
            >
              <span
                class="rounded-full bg-neutral-100"
                style={{ width: `${4 + i * 5}px`, height: `${4 + i * 5}px` }}
              />
            </button>
          ))}
          <input
            type="number"
            class="h-8 w-12 rounded-lg bg-white/10 px-1 text-center tabular-nums outline-none ring-1 ring-transparent hover:bg-white/15 focus-visible:ring-blue-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            min={MIN_WIDTH}
            max={MAX_WIDTH}
            step={1}
            value={pen.width}
            onInput={(event) => {
              const value = Number(event.currentTarget.value);
              if (!Number.isFinite(value) || value < MIN_WIDTH) return;
              onChange({ ...pen, width: Math.min(MAX_WIDTH, value) });
            }}
            aria-label={t("drawing.customSize")}
          />
        </div>
      )}
      {shows.opacity && (
        <label class="flex items-center gap-2">
          <OptionName Icon={Eye} name={t("drawing.inkOpacity")} />
          <input
            type="range"
            class="w-28 accent-blue-500"
            min={5}
            max={100}
            step={5}
            value={Math.round(pen.opacity * 100)}
            onInput={(event) =>
              onChange({
                ...pen,
                opacity: Number(event.currentTarget.value) / 100,
              })
            }
          />
          <span class="w-9 text-right tabular-nums">
            {Math.round(pen.opacity * 100)}%
          </span>
        </label>
      )}
      {shows.shapes && (
        <div class="flex items-center gap-1">
          <OptionName Icon={SquarePen} name={t("drawing.shapeStyle")} />
          {SHAPE_STYLES.map(({ style, label }) => (
            <button
              key={style}
              type="button"
              class={choice(pen.shapes === style)}
              onClick={() => onChange({ ...pen, shapes: style })}
              aria-label={t(label)}
              aria-pressed={pen.shapes === style}
            >
              <span
                class={`w-4 h-4 rounded-sm ${style === "filled" ? "" : "border-2 border-neutral-100"} ${style === "outline" ? "" : "bg-neutral-400"}`}
              />
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}
