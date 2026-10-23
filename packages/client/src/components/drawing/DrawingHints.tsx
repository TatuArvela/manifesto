import { Crop, SquareDashed, X } from "lucide-preact";
import { t } from "#/i18n/index.ts";
import { barButton, type Tool } from "./DrawingToolbar.tsx";

const selectionButton =
  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10 cursor-pointer disabled:cursor-default";

/**
 * The row under the paper: how to draw a polygon, or what to do with the
 * selected area, or how to select one. Nothing for the other tools.
 */
export function DrawingHints({
  tool,
  selected,
  canCropLayer,
  onCrop,
  onClearSelection,
}: {
  tool: Tool;
  selected: boolean;
  canCropLayer: boolean;
  onCrop: (crop: "image" | "layer") => void;
  onClearSelection: () => void;
}) {
  if (tool === "polygon") {
    return (
      <p class="[grid-area:hint] self-center px-2 text-center text-sm text-neutral-300">
        {t("drawing.polygonHint")}
      </p>
    );
  }
  if (selected) {
    return (
      <div class="[grid-area:hint] flex items-center justify-center gap-2 flex-wrap px-2 text-sm">
        <button
          type="button"
          class={selectionButton}
          onClick={() => onCrop("image")}
        >
          <Crop class="w-4 h-4" />
          {t("drawing.cropImage")}
        </button>
        <button
          type="button"
          class={selectionButton}
          onClick={() => onCrop("layer")}
          disabled={!canCropLayer}
        >
          <SquareDashed class="w-4 h-4" />
          {t("drawing.cropLayer")}
        </button>
        <button
          type="button"
          class={barButton}
          onClick={onClearSelection}
          aria-label={t("drawing.clearSelection")}
        >
          <X class="w-4 h-4" />
        </button>
      </div>
    );
  }
  if (tool === "select") {
    return (
      <p class="[grid-area:hint] self-center px-2 text-center text-sm text-neutral-300">
        {t("drawing.selectHint")}
      </p>
    );
  }
  return null;
}
