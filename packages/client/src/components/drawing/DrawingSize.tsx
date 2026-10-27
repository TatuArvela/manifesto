import { Link2, Link2Off } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { Tooltip } from "#/components/Tooltip.tsx";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { t } from "#/i18n/index.ts";
import type { PaperSize } from "#/utils/drawing.ts";
import { type Anchor, MAX_EDGE } from "#/utils/drawingLayers.ts";

/** What a new size changes: the paper around the drawing, or the drawing too. */
export type ResizeKind = "canvas" | "image";

type Unit = "px" | "percent";

const ANCHORS = [
  { at: [0, 0], label: "drawing.anchorTopLeft" },
  { at: [0.5, 0], label: "drawing.anchorTop" },
  { at: [1, 0], label: "drawing.anchorTopRight" },
  { at: [0, 0.5], label: "drawing.anchorLeft" },
  { at: [0.5, 0.5], label: "drawing.anchorCenter" },
  { at: [1, 0.5], label: "drawing.anchorRight" },
  { at: [0, 1], label: "drawing.anchorBottomLeft" },
  { at: [0.5, 1], label: "drawing.anchorBottom" },
  { at: [1, 1], label: "drawing.anchorBottomRight" },
] as const;

const gcd = (a: number, b: number): number => {
  let [x, y] = [a, b];
  while (y > 0) [x, y] = [y, x % y];
  return x;
};

/** The shape of a size: `16 : 9` when it is a ratio of small numbers. */
function ratio(width: number, height: number): string {
  const d = gcd(width, height);
  const [w, h] = [width / d, height / d];
  return w <= 50 && h <= 50
    ? `${w} : ${h}`
    : `${(width / height).toFixed(2)} : 1`;
}

const field =
  "w-20 rounded-md bg-neutral-900 px-2 py-1 text-sm tabular-nums text-neutral-100 ring-1 ring-white/20 focus:ring-blue-400";

const segment = (on: boolean) =>
  `flex-1 rounded-md px-2 py-1 cursor-pointer ${on ? "bg-blue-600 text-white" : "hover:bg-white/10"}`;

/**
 * The size of the picture. Canvas size gives the picture a new size and keeps
 * the drawing as it is: more paper, or a crop, around the anchor. Image size
 * stretches the drawing, and the image under it, to the new size. The size is
 * in pixels or in percent of the size now, and the link keeps its shape.
 *
 * On a wide screen, a section at the right of the paper. On a phone, a panel
 * that its button opens.
 */
export function DrawingSize({
  open,
  size,
  onResize,
  onClose,
}: {
  open: boolean;
  /** The size of the picture now, in pixels. */
  size: PaperSize;
  onResize: (
    kind: ResizeKind,
    width: number,
    height: number,
    anchor: Anchor,
  ) => void;
  onClose: () => void;
}) {
  useEscapeStack(open, onClose);
  const [kind, setKind] = useState<ResizeKind>("canvas");
  const [unit, setUnit] = useState<Unit>("px");
  const [linked, setLinked] = useState(true);
  const [anchor, setAnchor] = useState<Anchor>([0.5, 0.5]);
  const shown = (px: number, as: Unit = unit) =>
    as === "px" ? `${px}` : "100";
  const [width, setWidth] = useState(shown(size.width));
  const [height, setHeight] = useState(shown(size.height));

  // A new size of the picture, from here or from a crop or an undo, starts
  // the fields again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the size and the unit start the fields again
  useEffect(() => {
    setWidth(shown(size.width));
    setHeight(shown(size.height));
  }, [size.width, size.height, unit]);

  /** A value of a field in pixels, or null when it is not a size. */
  const pixels = (value: string, of: number): number | null => {
    const n = Number.parseFloat(value.replace(",", "."));
    if (!(Number.isFinite(n) && n > 0)) return null;
    const px = Math.round(unit === "px" ? n : (n / 100) * of);
    return px >= 1 && px <= MAX_EDGE ? px : null;
  };
  const w = pixels(width, size.width);
  const h = pixels(height, size.height);
  const changed =
    w !== null && h !== null && (w !== size.width || h !== size.height);

  /** The other field follows, in the shape of the picture now. */
  const follow = (value: string, from: number, to: number): string => {
    const n = Number.parseFloat(value.replace(",", "."));
    if (!Number.isFinite(n)) return "";
    return unit === "percent" ? value : `${Math.round((n * to) / from)}`;
  };

  return (
    <fieldset
      class={`${open ? "flex" : "hidden"} absolute right-2 bottom-full mb-1 w-64 max-w-[calc(100vw-1rem)] flex-col gap-2 rounded-lg bg-neutral-800 p-2 text-sm shadow-lg ring-1 ring-white/10 border-0 m-0 min-w-0 md:static md:flex md:w-auto md:max-w-none md:shadow-none md:ring-0`}
      aria-label={t("drawing.pictureSize")}
    >
      <h2 class="hidden md:block px-1 text-xs font-medium text-neutral-400">
        {t("drawing.pictureSize")}
      </h2>
      <div class="flex gap-0.5 rounded-lg bg-white/5 p-0.5">
        {(["canvas", "image"] as const).map((each) => (
          <button
            key={each}
            type="button"
            class={segment(kind === each)}
            onClick={() => setKind(each)}
            aria-pressed={kind === each}
          >
            {t(each === "canvas" ? "drawing.canvasSize" : "drawing.imageSize")}
          </button>
        ))}
      </div>
      <p class="px-1 text-xs text-neutral-400 tabular-nums">
        {t("drawing.megapixels", {
          n: (((w ?? size.width) * (h ?? size.height)) / 1e6).toFixed(2),
        })}
      </p>
      <div class="flex items-center gap-2">
        <div class="flex flex-col gap-1">
          <label class="flex items-center justify-between gap-2">
            {t("drawing.sizeWidth")}
            <input
              type="text"
              inputMode="decimal"
              class={field}
              value={width}
              onInput={(event) => {
                const value = event.currentTarget.value;
                setWidth(value);
                if (linked) setHeight(follow(value, size.width, size.height));
              }}
            />
          </label>
          <label class="flex items-center justify-between gap-2">
            {t("drawing.sizeHeight")}
            <input
              type="text"
              inputMode="decimal"
              class={field}
              value={height}
              onInput={(event) => {
                const value = event.currentTarget.value;
                setHeight(value);
                if (linked) setWidth(follow(value, size.height, size.width));
              }}
            />
          </label>
        </div>
        <Tooltip label={t("drawing.keepShape")}>
          <button
            type="button"
            class={`p-1.5 rounded-md cursor-pointer ${linked ? "bg-blue-600 text-white" : "text-neutral-300 hover:bg-white/10"}`}
            onClick={() => setLinked(!linked)}
            aria-label={t("drawing.keepShape")}
            aria-pressed={linked}
          >
            {linked ? <Link2 class="w-4 h-4" /> : <Link2Off class="w-4 h-4" />}
          </button>
        </Tooltip>
        <span class="text-xs text-neutral-400 tabular-nums">
          {w !== null && h !== null && ratio(w, h)}
        </span>
      </div>
      <label class="flex items-center justify-between gap-2">
        {t("drawing.unit")}
        <select
          class={`${field} w-auto`}
          value={unit}
          onChange={(event) => setUnit(event.currentTarget.value as Unit)}
        >
          <option value="px">{t("drawing.pixels")}</option>
          <option value="percent">{t("drawing.percent")}</option>
        </select>
      </label>
      {kind === "canvas" && (
        <div class="flex items-center justify-between gap-2">
          <span aria-hidden="true">{t("drawing.anchor")}</span>
          <fieldset
            class="grid grid-cols-3 gap-0.5 rounded-md bg-white/5 p-0.5 border-0 m-0 min-w-0"
            aria-label={t("drawing.anchor")}
          >
            {ANCHORS.map(({ at, label }) => {
              const on = anchor[0] === at[0] && anchor[1] === at[1];
              return (
                <button
                  key={label}
                  type="button"
                  class={`relative w-6 h-6 flex items-center justify-center rounded-sm cursor-pointer ${on ? "bg-white/20" : "hover:bg-white/10"}`}
                  onClick={() => setAnchor(at)}
                  aria-label={t(label)}
                  aria-pressed={on}
                >
                  <span
                    class={`rounded-full ${on ? "w-2.5 h-2.5 bg-white" : "w-1 h-1 bg-neutral-500"}`}
                  />
                </button>
              );
            })}
          </fieldset>
        </div>
      )}
      <button
        type="button"
        class="rounded-lg px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10 cursor-pointer disabled:cursor-default"
        disabled={!changed}
        onClick={() => {
          if (w === null || h === null) return;
          onResize(kind, w, h, anchor);
          onClose();
        }}
      >
        {t("drawing.applySize")}
      </button>
    </fieldset>
  );
}
