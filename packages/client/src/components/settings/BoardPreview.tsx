import { ArrowUp, Shuffle } from "lucide-preact";
import { t } from "#/i18n/index.ts";
import {
  type BoardGradientDirection,
  type BoardGradientDirectionChoice,
  boardGradient,
  boardGradientDirection,
  rerollBoardGradientDirection,
  resolvedBoardTexture,
} from "#/state/prefs.ts";

const selectedClass =
  "outline-2 outline-offset-2 outline-blue-500 dark:outline-blue-400";

/** Where each handle sits on the preview: a side's middle or a corner. */
const HANDLE_PLACE: Record<BoardGradientDirectionChoice, string> = {
  "top-left": "top-2 left-2",
  top: "top-2 left-1/2 -translate-x-1/2",
  "top-right": "top-2 right-2",
  left: "top-1/2 left-2 -translate-y-1/2",
  random: "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
  right: "top-1/2 right-2 -translate-y-1/2",
  "bottom-left": "bottom-2 left-2",
  bottom: "bottom-2 left-1/2 -translate-x-1/2",
  "bottom-right": "bottom-2 right-2",
};

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

/**
 * The board as it is composed now, colour, gradient and pattern, since on a
 * phone the page covers the real one. With a gradient it is also where the
 * direction is chosen: a handle on each side and corner fades the board
 * toward it, and the one in the middle is "random".
 */
export function BoardPreview({
  composing,
  compose,
}: {
  composing: boolean;
  compose: (change: () => void) => void;
}) {
  const direction = boardGradientDirection.value;
  const directionLabel = (way: BoardGradientDirectionChoice) =>
    t(`settings.boardBackground.gradient.${way}`);

  return (
    <fieldset
      aria-label={t("settings.boardBackground.gradient.direction")}
      data-texture={resolvedBoardTexture.value}
      class="board-texture-tile relative h-32 rounded-xl ring-1 ring-inset ring-black/10 dark:ring-white/15"
    >
      {boardGradient.value !== "none" &&
        (Object.keys(HANDLE_PLACE) as BoardGradientDirectionChoice[]).map(
          (way) => {
            const marked = composing && direction === way;
            return (
              <button
                key={way}
                type="button"
                class={`absolute ${HANDLE_PLACE[way]} w-7 h-7 rounded-full cursor-pointer flex items-center justify-center shadow-sm transition-colors ${
                  marked
                    ? `bg-white dark:bg-neutral-800 ${selectedClass}`
                    : "bg-white/60 dark:bg-neutral-900/50 hover:bg-white/90 dark:hover:bg-neutral-900/80"
                }`}
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
                aria-pressed={marked}
                title={directionLabel(way)}
              >
                {way === "random" ? (
                  <Shuffle class="w-3.5 h-3.5 text-neutral-700 dark:text-neutral-200" />
                ) : (
                  <ArrowUp
                    class="w-3.5 h-3.5 text-neutral-700 dark:text-neutral-200"
                    style={{ transform: `rotate(${ARROW_TURN[way]}deg)` }}
                  />
                )}
              </button>
            );
          },
        )}
    </fieldset>
  );
}
