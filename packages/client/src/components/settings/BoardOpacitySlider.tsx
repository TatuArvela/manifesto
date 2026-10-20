import { formatPercent, t } from "#/i18n/index.ts";
import { boardTextureOpacity, resolvedBoardTexture } from "#/state/prefs.ts";
import {
  MAX_TEXTURE_OPACITY,
  MIN_TEXTURE_OPACITY,
} from "#/utils/boardTextures.ts";
import { BoardCard } from "./BoardCard.tsx";

/**
 * The opacity of the pattern. One value for all textures and colors. Thus, when
 * you move between them, the board stays as strong as it was. The texture tiles
 * above use it immediately. Thus, they are the preview. With no pattern, it has
 * nothing to change. Thus, it is disabled.
 */
export function BoardOpacitySlider({
  compose,
}: {
  compose: (change: () => void) => void;
}) {
  const opacity = boardTextureOpacity.value;
  const disabled = resolvedBoardTexture.value === "none";
  return (
    <BoardCard
      legend={t("settings.boardBackground.opacity")}
      detail={formatPercent(opacity)}
      disabled={disabled}
    >
      <input
        type="range"
        class={`block w-full accent-blue-500 cursor-pointer disabled:cursor-default ${disabled ? "opacity-50" : ""}`}
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
    </BoardCard>
  );
}
