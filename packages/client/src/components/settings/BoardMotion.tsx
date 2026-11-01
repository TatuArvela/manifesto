import { Switch } from "#/components/ToggleSwitch.tsx";
import { t } from "#/i18n/index.ts";
import {
  animations,
  BOARD_GRADIENT_SPEEDS,
  boardGradientSpeed,
  boardTextureMotion,
  resolvedBoardGradient,
  resolvedBoardTexture,
} from "#/state/prefs.ts";
import { BoardCard } from "./BoardCard.tsx";

/**
 * How fast the gradient rolls in its direction, under the preview that shows
 * it. With no gradient, or with the animations off, it has nothing to change.
 * Thus, it is disabled. This card alone tells that the animations hold the board
 * still, because it is the first of the two.
 */
export function BoardRollSpeed({
  compose,
}: {
  compose: (change: () => void) => void;
}) {
  const speed = boardGradientSpeed.value;
  return (
    <div class="space-y-1.5">
      <BoardCard
        legend={t("settings.boardBackground.speed")}
        disabled={!animations.value || resolvedBoardGradient.value === "none"}
      >
        <div class="flex gap-1 p-1 rounded-lg bg-neutral-200/70 dark:bg-white/[0.06]">
          {BOARD_GRADIENT_SPEEDS.map((choice) => (
            <button
              key={choice}
              type="button"
              class={`flex-1 min-w-0 px-1 py-1 text-xs truncate rounded-md cursor-pointer transition-colors disabled:cursor-default disabled:opacity-50 ${
                speed === choice
                  ? "bg-white dark:bg-neutral-600 shadow-sm font-medium"
                  : "text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100"
              }`}
              aria-pressed={speed === choice}
              onClick={() =>
                compose(() => {
                  boardGradientSpeed.value = choice;
                })
              }
            >
              {t(`settings.boardBackground.speed.${choice}`)}
            </button>
          ))}
        </div>
      </BoardCard>
      {!animations.value && (
        <p class="px-1 text-xs text-neutral-500 dark:text-neutral-400">
          {t("settings.boardBackground.motionOff")}
        </p>
      )}
    </div>
  );
}

/**
 * If the pattern moves. Each pattern has its own motion (preferences.css), and
 * the tiles show it. With no pattern, or with the animations off, it has nothing
 * to change. Thus, it is disabled, which the fieldset of the card does for the
 * switch in it.
 */
export function BoardPatternMotion({
  compose,
}: {
  compose: (change: () => void) => void;
}) {
  const label = t("settings.boardBackground.patternMotion");
  const disabled = !animations.value || resolvedBoardTexture.value === "none";
  return (
    <BoardCard legend={label} disabled={disabled}>
      <span class={`flex ${disabled ? "opacity-50" : ""}`}>
        <Switch
          checked={boardTextureMotion.value}
          onChange={(checked) =>
            compose(() => {
              boardTextureMotion.value = checked;
            })
          }
          label={label}
        />
      </span>
    </BoardCard>
  );
}
