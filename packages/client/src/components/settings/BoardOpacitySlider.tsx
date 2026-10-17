import { formatPercent, t } from "../../i18n/index.js";
import {
  boardTextureOpacity,
  resolvedBoardTexture,
} from "../../state/prefs.js";
import {
  MAX_TEXTURE_OPACITY,
  MIN_TEXTURE_OPACITY,
} from "../../utils/boardTextures.js";

const legendClass =
  "text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2";

/**
 * How opaque the pattern is drawn. One value for every texture and colour,
 * so moving it between them keeps the board as strong as it was; the texture
 * tiles above take it at once, so they are the preview. With no pattern there
 * is nothing for it to change, so it waits disabled.
 */
export function BoardOpacitySlider({
  compose,
}: {
  compose: (change: () => void) => void;
}) {
  const opacity = boardTextureOpacity.value;
  const disabled = resolvedBoardTexture.value === "none";
  return (
    <fieldset disabled={disabled}>
      <legend class={legendClass}>
        {t("settings.boardBackground.opacity")}
      </legend>
      <div class={`flex items-center gap-3 ${disabled ? "opacity-50" : ""}`}>
        <input
          type="range"
          class="flex-1 min-w-0 accent-blue-500 cursor-pointer disabled:cursor-default"
          min={MIN_TEXTURE_OPACITY}
          max={MAX_TEXTURE_OPACITY}
          step={1}
          value={opacity}
          aria-label={t("settings.boardBackground.opacity")}
          aria-valuetext={formatPercent(opacity)}
          onInput={(e) =>
            compose(() => {
              boardTextureOpacity.value = e.currentTarget.valueAsNumber;
            })
          }
        />
        <span class="w-12 shrink-0 text-right text-sm tabular-nums text-neutral-600 dark:text-neutral-300">
          {formatPercent(opacity)}
        </span>
      </div>
    </fieldset>
  );
}
