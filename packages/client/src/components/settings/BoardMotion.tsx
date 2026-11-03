import type { Signal } from "@preact/signals";
import { formatPercent, t } from "#/i18n/index.ts";
import {
  resolvedBoardGradient,
  resolvedBoardTexture,
} from "#/state/boardBackground.ts";
import {
  animations,
  BOARD_SPEED_STEP,
  boardGradientSpeed,
  boardTextureSpeed,
  MAX_BOARD_SPEED,
} from "#/state/prefs.ts";
import { BoardCard } from "./BoardCard.tsx";

/**
 * A speed of the board, from still to twice its usual speed. The board follows
 * the slider while it moves, with no jump (state/boardBackground.ts changes
 * the rate of the running layers, not their time).
 */
function BoardSpeedSlider({
  legend,
  speed,
  disabled,
  compose,
}: {
  legend: string;
  speed: Signal<number>;
  disabled: boolean;
  compose: (change: () => void) => void;
}) {
  const value = speed.value;
  const shown =
    value === 0
      ? t("settings.boardBackground.speed.still")
      : formatPercent(value);
  return (
    <BoardCard legend={legend} detail={shown} disabled={disabled}>
      <input
        type="range"
        class={`block w-full accent-blue-500 cursor-pointer disabled:cursor-default ${disabled ? "opacity-50" : ""}`}
        min={0}
        max={MAX_BOARD_SPEED}
        step={BOARD_SPEED_STEP}
        value={value}
        aria-label={legend}
        aria-valuetext={shown}
        onInput={(e) =>
          compose(() => {
            speed.value = e.currentTarget.valueAsNumber;
          })
        }
      />
    </BoardCard>
  );
}

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
  return (
    <div class="space-y-1.5">
      <BoardSpeedSlider
        legend={t("settings.boardBackground.speed")}
        speed={boardGradientSpeed}
        disabled={!animations.value || resolvedBoardGradient.value === "none"}
        compose={compose}
      />
      {!animations.value && (
        <p class="px-1 text-xs text-neutral-500 dark:text-neutral-400">
          {t("settings.boardBackground.motionOff")}
        </p>
      )}
    </div>
  );
}

/**
 * How fast the pattern moves. Each pattern has its own motion
 * (board-motion.css), and the tiles show it. With no pattern, or with the
 * animations off, it has nothing to change. Thus, it is disabled.
 */
export function BoardPatternSpeed({
  compose,
}: {
  compose: (change: () => void) => void;
}) {
  return (
    <BoardSpeedSlider
      legend={t("settings.boardBackground.patternSpeed")}
      speed={boardTextureSpeed}
      disabled={!animations.value || resolvedBoardTexture.value === "none"}
      compose={compose}
    />
  );
}
