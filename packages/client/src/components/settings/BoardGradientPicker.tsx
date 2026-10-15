import { ArrowUp, Ban, Shuffle } from "lucide-preact";
import { t } from "../../i18n/index.js";
import {
  BOARD_COLORS,
  BOARD_NEUTRALS,
  type BoardGradientChoice,
  type BoardGradientDirection,
  type BoardGradientDirectionChoice,
  boardGradient,
  boardGradientCustomColor,
  boardGradientDirection,
  rerollBoardGradient,
  rerollBoardGradientDirection,
  resolvedBoardGradient,
  resolvedBoardGradientDirection,
} from "../../state/index.js";
import { boardColorLabel } from "./boardLabels.js";

const ringClass = "ring-1 ring-inset ring-black/10 dark:ring-white/15";
const selectedClass =
  "outline-2 outline-offset-2 outline-blue-500 dark:outline-blue-400";
const legendClass =
  "text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2";

/** Row by row, as the arrows sit around a compass, "random" in its middle. */
const COMPASS: readonly BoardGradientDirectionChoice[] = [
  "top-left",
  "top",
  "top-right",
  "left",
  "random",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
];

/** How far the one arrow icon turns to point each way. */
const ARROW_TURN: Record<BoardGradientDirection, number> = {
  top: 0,
  "top-right": 45,
  right: 90,
  "bottom-right": 135,
  bottom: 180,
  "bottom-left": 225,
  left: 270,
  "top-left": 315,
};

function gradientLabel(choice: BoardGradientChoice): string {
  return choice === "none"
    ? t("settings.boardBackground.gradient.none")
    : boardColorLabel(choice);
}

/** The gradient a direction makes, from the board's colour to the second. */
function gradientToward(way: BoardGradientDirection): string {
  return `linear-gradient(to ${way.replace("-", " ")}, var(--board-color, var(--board-page)), var(--board-color-to))`;
}

/**
 * The second colour of the composer, which the board fades to from its first,
 * and below it, once there is one, which way. Each direction is drawn as the
 * gradient it would make, so the compass is its own preview; its middle is
 * "random", drawn as the direction it stands for now.
 */
export function BoardGradientPicker({
  composing,
  compose,
}: {
  composing: boolean;
  compose: (change: () => void) => void;
}) {
  const gradient = boardGradient.value;
  const direction = boardGradientDirection.value;
  const swatchClass = (selected: boolean) =>
    `board-swatch w-6 h-6 sm:w-7 sm:h-7 rounded-full cursor-pointer flex items-center justify-center ${ringClass} ${composing && selected ? selectedClass : ""}`;
  const directionLabel = (way: BoardGradientDirectionChoice) =>
    t(`settings.boardBackground.gradient.${way}`);

  return (
    <>
      <fieldset>
        <legend class={legendClass}>
          {t("settings.boardBackground.gradient")}
        </legend>
        <div class="flex flex-wrap gap-2 sm:gap-2.5">
          {(["none", ...BOARD_NEUTRALS, ...BOARD_COLORS] as const).map(
            (choice) => (
              <button
                key={choice}
                type="button"
                data-board-swatch={choice}
                class={swatchClass(gradient === choice)}
                onClick={() =>
                  compose(() => {
                    boardGradient.value = choice;
                  })
                }
                aria-label={gradientLabel(choice)}
                aria-pressed={composing && gradient === choice}
                title={gradientLabel(choice)}
              >
                {choice === "none" && (
                  <Ban class="w-4 h-4 text-neutral-400 dark:text-neutral-500" />
                )}
              </button>
            ),
          )}
          <button
            type="button"
            data-board-swatch={
              gradient === "random" ? resolvedBoardGradient.value : "none"
            }
            class={swatchClass(gradient === "random")}
            onClick={() =>
              compose(() => {
                // Picking "random" again is how to ask for another.
                if (gradient === "random") rerollBoardGradient();
                boardGradient.value = "random";
              })
            }
            aria-label={gradientLabel("random")}
            aria-pressed={composing && gradient === "random"}
            title={gradientLabel("random")}
          >
            <Shuffle class="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
          </button>
          <span
            aria-hidden="true"
            class="self-center w-px h-5 mx-0.5 bg-neutral-300 dark:bg-white/15"
          />
          <label
            class={`relative w-6 h-6 sm:w-7 sm:h-7 rounded-full cursor-pointer p-[3px] bg-[conic-gradient(#f87171,#facc15,#4ade80,#38bdf8,#a78bfa,#f472b6,#f87171)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-500 ${composing && gradient === "custom" ? selectedClass : ""}`}
            title={gradientLabel("custom")}
          >
            <span
              data-board-swatch="gradient-custom"
              class="board-swatch block w-full h-full rounded-full"
            />
            <input
              type="color"
              class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              value={boardGradientCustomColor.value}
              aria-label={gradientLabel("custom")}
              onClick={() =>
                compose(() => {
                  boardGradient.value = "custom";
                })
              }
              onInput={(e) =>
                compose(() => {
                  boardGradientCustomColor.value = e.currentTarget.value;
                  boardGradient.value = "custom";
                })
              }
            />
          </label>
        </div>
      </fieldset>

      {gradient !== "none" && (
        <fieldset>
          <legend class={legendClass}>
            {t("settings.boardBackground.gradient.direction")}
          </legend>
          <div class="grid grid-cols-3 gap-1 w-fit">
            {COMPASS.map((way) => (
              <button
                key={way}
                type="button"
                class={`w-9 h-9 rounded-md cursor-pointer flex items-center justify-center ${ringClass} ${composing && direction === way ? selectedClass : ""}`}
                style={{
                  backgroundImage: gradientToward(
                    way === "random"
                      ? resolvedBoardGradientDirection.value
                      : way,
                  ),
                }}
                onClick={() =>
                  compose(() => {
                    // Picking "random" again is how to ask for another.
                    if (way === "random" && direction === "random") {
                      rerollBoardGradientDirection();
                    }
                    boardGradientDirection.value = way;
                  })
                }
                aria-label={directionLabel(way)}
                aria-pressed={composing && direction === way}
                title={directionLabel(way)}
              >
                {way === "random" ? (
                  <Shuffle class="w-4 h-4 text-neutral-600/80 dark:text-neutral-300/80" />
                ) : (
                  <ArrowUp
                    class="w-3.5 h-3.5 text-neutral-600/70 dark:text-neutral-300/70"
                    style={{ transform: `rotate(${ARROW_TURN[way]}deg)` }}
                  />
                )}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </>
  );
}
