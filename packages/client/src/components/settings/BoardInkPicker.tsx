import { Shuffle } from "lucide-preact";
import { t } from "../../i18n/index.js";
import {
  type BoardInk,
  boardInk,
  boardInkColor,
  rerollBoardInk,
  resolvedBoardInk,
} from "../../state/index.js";
import { INK_COLORS, type InkColor } from "../../utils/boardTextures.js";

const ringClass = "ring-1 ring-inset ring-black/10 dark:ring-white/15";
const selectedClass =
  "outline-2 outline-offset-2 outline-blue-500 dark:outline-blue-400";
const legendClass =
  "text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2";

/** "auto", the theme's faint ink, sits between white and black as the gray. */
const PRESETS = [
  "white",
  "auto",
  "black",
] as const satisfies readonly BoardInk[];

/**
 * What colour the texture is drawn in. The texture tiles above take it at
 * once, so they are the preview; "auto" is the faint ink of the theme, gray
 * on either, so it is offered as the gray between white and black. The colourful ones are named as the
 * note colours they share a hue with.
 */
export function BoardInkPicker({
  composing,
  compose,
}: {
  composing: boolean;
  compose: (change: () => void) => void;
}) {
  const ink = boardInk.value;
  const label = (choice: Exclude<BoardInk, InkColor>) =>
    t(`settings.boardBackground.ink.${choice}`);
  const colors = Object.entries(INK_COLORS) as [InkColor, string][];

  return (
    <fieldset>
      <legend class={legendClass}>{t("settings.boardBackground.ink")}</legend>
      <div class="flex flex-wrap gap-2 sm:gap-2.5">
        {PRESETS.map((choice) => (
          <button
            key={choice}
            type="button"
            data-board-swatch={`ink-${choice}`}
            class={`board-swatch w-6 h-6 sm:w-7 sm:h-7 rounded-full cursor-pointer ${ringClass} ${composing && ink === choice ? selectedClass : ""}`}
            onClick={() =>
              compose(() => {
                boardInk.value = choice;
              })
            }
            aria-label={label(choice)}
            aria-pressed={composing && ink === choice}
            title={label(choice)}
          />
        ))}
        <span
          aria-hidden="true"
          class="self-center w-px h-5 mx-0.5 bg-neutral-300 dark:bg-white/15"
        />
        {colors.map(([choice, hex]) => (
          <button
            key={choice}
            type="button"
            class={`w-6 h-6 sm:w-7 sm:h-7 rounded-full cursor-pointer ${ringClass} ${composing && ink === choice ? selectedClass : ""}`}
            style={{ backgroundColor: hex }}
            onClick={() =>
              compose(() => {
                boardInk.value = choice;
              })
            }
            aria-label={t(`color.${choice}`)}
            aria-pressed={composing && ink === choice}
            title={t(`color.${choice}`)}
          />
        ))}
        <button
          type="button"
          class={`w-6 h-6 sm:w-7 sm:h-7 rounded-full cursor-pointer flex items-center justify-center bg-white dark:bg-neutral-800 ${ringClass} ${composing && ink === "random" ? selectedClass : ""}`}
          style={
            ink === "random"
              ? {
                  backgroundColor:
                    INK_COLORS[resolvedBoardInk.value as InkColor],
                }
              : undefined
          }
          onClick={() =>
            compose(() => {
              // Picking "random" again is how to ask for another.
              if (ink === "random") rerollBoardInk();
              boardInk.value = "random";
            })
          }
          aria-label={label("random")}
          aria-pressed={composing && ink === "random"}
          title={label("random")}
        >
          <Shuffle class="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
        </button>
        <span
          aria-hidden="true"
          class="self-center w-px h-5 mx-0.5 bg-neutral-300 dark:bg-white/15"
        />
        <label
          class={`relative w-6 h-6 sm:w-7 sm:h-7 rounded-full cursor-pointer p-[3px] bg-[conic-gradient(#f87171,#facc15,#4ade80,#38bdf8,#a78bfa,#f472b6,#f87171)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-500 ${composing && ink === "custom" ? selectedClass : ""}`}
          title={label("custom")}
        >
          <span
            data-board-swatch="ink-custom"
            class="board-swatch block w-full h-full rounded-full"
          />
          <input
            type="color"
            class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            value={boardInkColor.value}
            aria-label={label("custom")}
            onClick={() =>
              compose(() => {
                boardInk.value = "custom";
              })
            }
            onInput={(e) =>
              compose(() => {
                boardInkColor.value = e.currentTarget.value;
                boardInk.value = "custom";
              })
            }
          />
        </label>
      </div>
    </fieldset>
  );
}
