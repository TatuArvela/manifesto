import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { t } from "#/i18n/index.ts";
import type { PenTip } from "#/utils/drawing.ts";

/** Pen widths, in the own pixels of a new drawing. */
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
}

/** The look of a tip on its button, as the paper shows it. */
export function tipStyle(tip: PenTip, size: number) {
  return {
    width: `${size}px`,
    height: `${tip === "oval" ? size * 0.35 : size}px`,
    borderRadius: tip === "square" ? "0" : "9999px",
    transform: tip === "oval" ? "rotate(-45deg)" : undefined,
  };
}

const choice = (on: boolean) =>
  `w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer ${on ? "bg-white/20" : "hover:bg-white/10"}`;

/**
 * The shape, width and transparency of the pen. The width has three sizes to
 * press, and a field for any other, in the pixels of a new drawing. Thus, a
 * width looks the same on paper of any size.
 */
export function DrawingPen({
  pen,
  onChange,
  onClose,
}: {
  pen: PenSettings;
  onChange: (next: PenSettings) => void;
  onClose: () => void;
}) {
  useEscapeStack(true, onClose);

  return (
    <fieldset
      class="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 w-64 max-w-[calc(100vw-1rem)] rounded-lg bg-neutral-800 p-2 shadow-lg ring-1 ring-white/10 border-0 m-0 min-w-0 flex flex-col gap-2 text-sm"
      aria-label={t("drawing.pen")}
    >
      <div class="flex items-center gap-1">
        <span class="flex-1">{t("drawing.tip")}</span>
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
      <div class="flex items-center gap-1">
        <span class="flex-1">{t("drawing.size")}</span>
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
          class="w-14 rounded-md bg-neutral-900 px-1.5 py-1 text-right ring-1 ring-white/20"
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
      <label class="flex items-center gap-2">
        <span class="flex-1">{t("drawing.inkOpacity")}</span>
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
    </fieldset>
  );
}
