import { Shuffle } from "lucide-preact";
import { t } from "#/i18n/index.ts";
import {
  type BoardInk,
  boardInk,
  boardInkColor,
  rerollBoardInk,
  resolvedBoardInk,
} from "#/state/prefs.ts";
import { INK_COLORS, type InkColor } from "#/utils/boardTextures.ts";
import { BoardCard } from "./BoardCard.tsx";

const ringClass = "ring-1 ring-inset ring-black/10 dark:ring-white/15";
const selectedClass =
  "outline-2 outline-offset-2 outline-blue-500 dark:outline-blue-400";
const swatchClass = "w-6 h-6 sm:w-7 sm:h-7 rounded-full cursor-pointer";

/**
 * "auto", the faint ink of the theme, is between white and black as the gray.
 */
const PRESETS = [
  "white",
  "auto",
  "black",
] as const satisfies readonly BoardInk[];

/**
 * The color in which the texture is drawn, as a card with the same layout as
 * the colors of the board. "random" is on the first row, where it is in their
 * card. Where "none" would be next to it, there is nothing (the pattern has its
 * own). Then white, gray and black with the native picker, then the presets.
 * The texture tiles use it immediately. Thus, they are the preview. "auto" is
 * the faint ink of the theme, gray on both. Thus, it shows as the gray between
 * white and black. The colorful choices have the names of the note colors with
 * the same hue.
 */
export function BoardInkPicker({
  composing,
  compose,
  disabled,
}: {
  composing: boolean;
  compose: (change: () => void) => void;
  disabled: boolean;
}) {
  const ink = boardInk.value;
  const label = (choice: Exclude<BoardInk, InkColor>) =>
    t(`settings.boardBackground.ink.${choice}`);
  const colors = Object.entries(INK_COLORS) as [InkColor, string][];
  const marked = (choice: BoardInk) => composing && ink === choice;
  const pick = (choice: BoardInk) =>
    compose(() => {
      boardInk.value = choice;
    });

  return (
    <BoardCard legend={t("settings.boardBackground.ink")} disabled={disabled}>
      <div
        class={`grid grid-cols-4 gap-2 sm:gap-2.5 w-fit mx-auto ${disabled ? "opacity-50" : ""}`}
      >
        <button
          type="button"
          class={`col-start-3 col-span-2 h-6 sm:h-7 rounded-full cursor-pointer disabled:cursor-default flex items-center justify-center bg-white dark:bg-neutral-800 ${ringClass} ${marked("random") ? selectedClass : ""}`}
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
              // A new selection of "random" is how to ask for a different one.
              if (ink === "random") rerollBoardInk();
              boardInk.value = "random";
            })
          }
          aria-label={label("random")}
          aria-pressed={marked("random")}
          title={label("random")}
        >
          <Shuffle class="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
        </button>
        {PRESETS.map((choice) => (
          <button
            key={choice}
            type="button"
            data-board-swatch={`ink-${choice}`}
            class={`board-swatch ${swatchClass} disabled:cursor-default ${ringClass} ${marked(choice) ? selectedClass : ""}`}
            onClick={() => pick(choice)}
            aria-label={label(choice)}
            aria-pressed={marked(choice)}
            title={label(choice)}
          />
        ))}
        <label
          class={`relative ${swatchClass} p-[3px] bg-[conic-gradient(#f87171,#facc15,#4ade80,#38bdf8,#a78bfa,#f472b6,#f87171)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-500 ${marked("custom") ? selectedClass : ""}`}
          title={label("custom")}
        >
          <span
            data-board-swatch="ink-custom"
            class="board-swatch block w-full h-full rounded-full"
          />
          <input
            type="color"
            class="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
            value={boardInkColor.value}
            aria-label={label("custom")}
            onClick={() => pick("custom")}
            onInput={(e) =>
              compose(() => {
                boardInkColor.value = e.currentTarget.value;
                boardInk.value = "custom";
              })
            }
          />
        </label>
        {colors.map(([choice, hex]) => (
          <button
            key={choice}
            type="button"
            class={`${swatchClass} disabled:cursor-default ${ringClass} ${marked(choice) ? selectedClass : ""}`}
            style={{ backgroundColor: hex }}
            onClick={() => pick(choice)}
            aria-label={t(`color.${choice}`)}
            aria-pressed={marked(choice)}
            title={t(`color.${choice}`)}
          />
        ))}
      </div>
    </BoardCard>
  );
}
