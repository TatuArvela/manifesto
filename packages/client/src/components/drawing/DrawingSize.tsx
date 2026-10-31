import { Link2, Link2Off, Undo2 } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { Tooltip } from "#/components/Tooltip.tsx";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { t } from "#/i18n/index.ts";
import type { PaperSize } from "#/utils/drawing.ts";
import { type Anchor, MAX_EDGE } from "#/utils/drawingLayers.ts";
import { evaluateArithmetic } from "#/utils/evaluateExpression.ts";
import { phonePanel, SidePanel } from "./SidePanel.tsx";

/** What a new size changes: the paper around the drawing, or the drawing too. */
export type ResizeKind = "canvas" | "image";

type Unit = "px" | "percent";

/** The fields of one tab. */
type Fields = { width: string; height: string; unit: Unit; linked: boolean };

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

/**
 * The number in a field. A field takes arithmetic (`1920 / 2`), and a comma
 * or a point as the decimal separator.
 */
const amount = (value: string): number | null =>
  evaluateArithmetic(value.trim().replaceAll(",", "."), ".");

/** A number as a field shows it: no more than two decimals. */
const written = (n: number): string => `${Math.round(n * 100) / 100}`;

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
  const [anchor, setAnchor] = useState<Anchor>([0.5, 0.5]);
  const fresh = (as: Unit = "px", keep = true): Fields => ({
    width: as === "px" ? `${size.width}` : "100",
    height: as === "px" ? `${size.height}` : "100",
    unit: as,
    linked: keep,
  });
  // Each tab keeps its own fields. Thus, values from one tab never apply
  // through the other.
  const [tabs, setTabs] = useState<Record<ResizeKind, Fields>>(() => ({
    canvas: fresh(),
    image: fresh(),
  }));
  const { width, height, unit, linked } = tabs[kind];
  const edit = (change: Partial<Fields>) =>
    setTabs((all) => ({ ...all, [kind]: { ...all[kind], ...change } }));
  const setUnit = (as: Unit) => edit(fresh(as, linked));

  // A new size of the picture, from here or from a crop or an undo, starts
  // the fields of both tabs again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the size starts the fields again
  useEffect(() => {
    setTabs((all) => ({
      canvas: fresh(all.canvas.unit, all.canvas.linked),
      image: fresh(all.image.unit, all.image.linked),
    }));
  }, [size.width, size.height]);

  /** A value of a field in pixels, or null when it is not a size. */
  const pixels = (value: string, of: number): number | null => {
    const n = amount(value);
    if (n === null || !(n > 0)) return null;
    const px = Math.round(unit === "px" ? n : (n / 100) * of);
    return px >= 1 && px <= MAX_EDGE ? px : null;
  };
  const w = pixels(width, size.width);
  const h = pixels(height, size.height);
  const changed =
    w !== null && h !== null && (w !== size.width || h !== size.height);

  const start = fresh(unit, linked);
  const edited = width !== start.width || height !== start.height;

  /** The other field follows, in the shape of the picture now. */
  const follow = (value: string, from: number, to: number): string => {
    const n = amount(value);
    if (n === null) return "";
    return unit === "percent" ? written(n) : `${Math.round((n * to) / from)}`;
  };

  /** A new value in one field. With the link, the other field follows. */
  const type = (axis: "width" | "height", value: string) => {
    const [from, to] =
      axis === "width" ? [size.width, size.height] : [size.height, size.width];
    const other = axis === "width" ? "height" : "width";
    edit({
      [axis]: value,
      ...(linked && { [other]: follow(value, from, to) }),
    });
  };

  /**
   * Up and Down step the value by one, or by ten with Shift. Enter and a blur
   * show the result of the arithmetic in the field.
   */
  const keys = (axis: "width" | "height") => ({
    onKeyDown: (event: KeyboardEvent) => {
      const value = axis === "width" ? width : height;
      if (event.key === "Enter") {
        const n = amount(value);
        if (n !== null) type(axis, written(n));
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const step =
        (event.shiftKey ? 10 : 1) * (event.key === "ArrowUp" ? 1 : -1);
      const n = amount(value) ?? 0;
      type(axis, written(Math.max(1, Math.round(n) + step)));
    },
    onBlur: () => {
      const value = axis === "width" ? width : height;
      const n = amount(value);
      if (n !== null && written(n) !== value.trim()) type(axis, written(n));
    },
  });

  return (
    <SidePanel
      label={t("drawing.pictureSize")}
      class={phonePanel(open)}
      body="flex flex-col gap-2 p-1 text-sm md:p-0"
    >
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
              onInput={(event) => type("width", event.currentTarget.value)}
              {...keys("width")}
            />
          </label>
          <label class="flex items-center justify-between gap-2">
            {t("drawing.sizeHeight")}
            <input
              type="text"
              inputMode="decimal"
              class={field}
              value={height}
              onInput={(event) => type("height", event.currentTarget.value)}
              {...keys("height")}
            />
          </label>
        </div>
        <Tooltip label={t("drawing.keepShape")}>
          <button
            type="button"
            class={`p-1.5 rounded-md cursor-pointer ${linked ? "bg-blue-600 text-white" : "text-neutral-300 hover:bg-white/10"}`}
            onClick={() => edit({ linked: !linked })}
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
      <div class="flex gap-2">
        <Tooltip label={t("drawing.resetSize")}>
          <button
            type="button"
            class="rounded-lg p-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10 cursor-pointer disabled:cursor-default"
            disabled={!edited}
            onClick={() => edit(fresh(unit, linked))}
            aria-label={t("drawing.resetSize")}
          >
            <Undo2 class="w-4 h-4" />
          </button>
        </Tooltip>
        <button
          type="button"
          class="flex-1 rounded-lg px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10 cursor-pointer disabled:cursor-default"
          disabled={!changed}
          onClick={() => {
            if (w === null || h === null) return;
            onResize(kind, w, h, anchor);
            onClose();
          }}
        >
          {t("drawing.applySize")}
        </button>
      </div>
    </SidePanel>
  );
}
