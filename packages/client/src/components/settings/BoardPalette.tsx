import { Ban, Shuffle } from "lucide-preact";
import {
  BOARD_COLORS,
  BOARD_NEUTRALS,
  type BoardColorChoice,
} from "#/state/prefs.ts";
import { BoardCard } from "./BoardCard.tsx";
import { boardColorLabel } from "./boardLabels.ts";

const ringClass = "ring-1 ring-inset ring-black/10 dark:ring-white/15";
const selectedClass =
  "outline-2 outline-offset-2 outline-blue-500 dark:outline-blue-400";
const swatchClass = "w-6 h-6 sm:w-7 sm:h-7 rounded-full cursor-pointer";

/**
 * One of the two colors of the board, as a card of swatches, four across. Its
 * first row is the two choices that are not a color, "none" and "random", each
 * as wide as two swatches, where they are in each picker on the page. Then the
 * neutrals and the native picker, then the presets.
 */
export function BoardPalette({
  legend,
  value,
  selected,
  noneLabel,
  randomShows,
  customSwatch,
  customValue,
  onPick,
  onReroll,
  onCustom,
}: {
  legend: string;
  value: BoardColorChoice;
  /** False while the picture is on the board. Thus, nothing here has a mark. */
  selected: boolean;
  noneLabel: string;
  /** What "random" means now. Its swatch shows in it after the selection. */
  randomShows: Exclude<BoardColorChoice, "random">;
  /** The `data-board-swatch` that draws `customValue` as the board would. */
  customSwatch: "custom" | "gradient-custom";
  customValue: string;
  onPick: (choice: BoardColorChoice) => void;
  onReroll: () => void;
  onCustom: (hex: string) => void;
}) {
  const label = (choice: BoardColorChoice) =>
    choice === "none" ? noneLabel : boardColorLabel(choice);
  const marked = (choice: BoardColorChoice) => selected && value === choice;

  const swatch = (choice: Exclude<BoardColorChoice, "custom" | "random">) => (
    <button
      key={choice}
      type="button"
      data-board-swatch={choice}
      class={`board-swatch ${swatchClass} flex items-center justify-center ${ringClass} ${marked(choice) ? selectedClass : ""}`}
      onClick={() => onPick(choice)}
      aria-label={label(choice)}
      aria-pressed={marked(choice)}
      title={label(choice)}
    />
  );

  return (
    <BoardCard legend={legend}>
      <div class="grid grid-cols-4 gap-2 sm:gap-2.5 w-fit mx-auto">
        <button
          type="button"
          data-board-swatch="none"
          class={`board-swatch col-span-2 h-6 sm:h-7 rounded-full cursor-pointer flex items-center justify-center ${ringClass} ${marked("none") ? selectedClass : ""}`}
          onClick={() => onPick("none")}
          aria-label={label("none")}
          aria-pressed={marked("none")}
          title={label("none")}
        >
          <Ban class="w-4 h-4 text-neutral-400 dark:text-neutral-500" />
        </button>
        <button
          type="button"
          data-board-swatch={value === "random" ? randomShows : "none"}
          class={`board-swatch col-span-2 h-6 sm:h-7 rounded-full cursor-pointer flex items-center justify-center ${ringClass} ${marked("random") ? selectedClass : ""}`}
          onClick={() => {
            // A new selection of "random" is how to ask for a different one.
            if (value === "random") onReroll();
            onPick("random");
          }}
          aria-label={label("random")}
          aria-pressed={marked("random")}
          title={label("random")}
        >
          <Shuffle class="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
        </button>
        {BOARD_NEUTRALS.map(swatch)}
        {/* The native picker, under a swatch that shows what it holds. The
            rainbow rim is what says "any colour" before one is set. */}
        <label
          class={`relative ${swatchClass} p-[3px] bg-[conic-gradient(#f87171,#facc15,#4ade80,#38bdf8,#a78bfa,#f472b6,#f87171)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-500 ${marked("custom") ? selectedClass : ""}`}
          title={label("custom")}
        >
          <span
            data-board-swatch={customSwatch}
            class="board-swatch block w-full h-full rounded-full"
          />
          <input
            type="color"
            class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            value={customValue}
            aria-label={label("custom")}
            onClick={() => onPick("custom")}
            onInput={(e) => onCustom(e.currentTarget.value)}
          />
        </label>
        {BOARD_COLORS.map(swatch)}
      </div>
    </BoardCard>
  );
}
