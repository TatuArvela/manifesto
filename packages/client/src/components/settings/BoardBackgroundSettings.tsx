import { Ban, ImagePlus, Shuffle, Trash2 } from "lucide-preact";
import { useRef, useState } from "preact/hooks";
import { t } from "#/i18n/index.ts";
import {
  boardImageUrl,
  removeBoardImage,
  setBoardImage,
} from "#/state/board.ts";
import {
  BOARD_COLORS,
  BOARD_NEUTRALS,
  BOARD_TEXTURES,
  type BoardTextureChoice,
  boardColor,
  boardCustomColor,
  boardImageStamp,
  boardTexture,
  boardUsePicture,
  rerollBoardColor,
  rerollBoardTexture,
  resolvedBoardColor,
  resolvedBoardTexture,
} from "#/state/prefs.ts";
import { BoardGradientPicker } from "./BoardGradientPicker.tsx";
import { BoardInkPicker } from "./BoardInkPicker.tsx";
import { BoardOpacitySlider } from "./BoardOpacitySlider.tsx";
import { boardColorLabel } from "./boardLabels.ts";
import { SettingsHeading } from "./SettingsControls.tsx";

const ringClass = "ring-1 ring-inset ring-black/10 dark:ring-white/15";
const selectedClass =
  "outline-2 outline-offset-2 outline-blue-500 dark:outline-blue-400";

function textureLabel(texture: BoardTextureChoice): string {
  return t(`settings.boardBackground.texture.${texture}`);
}

/**
 * Settings > Board Background, a page of its own. The board has two kinds of
 * background, and the page says which one it is composing: a colour with a
 * texture drawn over it, or a picture of the user's own that covers the whole
 * board instead. Every choice applies at once, to the board visible behind
 * the modal.
 */
export function BoardBackgroundSettings() {
  const pictureInputRef = useRef<HTMLInputElement>(null);
  const hasPicture = boardImageStamp.value > 0;
  const showingPicture = boardUsePicture.value && hasPicture;
  // Which kind the page shows. The picture tab can be open with no picture
  // yet, to choose one, while the board keeps its colour.
  const [mode, setMode] = useState<"compose" | "picture">(
    showingPicture ? "picture" : "compose",
  );
  const color = boardColor.value;
  const texture = boardTexture.value;

  /** Choosing a colour or texture is composing, so the picture steps aside. */
  const compose = (change: () => void) => {
    change();
    boardUsePicture.value = false;
  };

  const composing = !showingPicture;

  const switchTo = (next: "compose" | "picture") => {
    setMode(next);
    boardUsePicture.value = next === "picture" && hasPicture;
  };

  const modeButton = (value: "compose" | "picture", label: string) => (
    <button
      type="button"
      class={`flex-1 px-3 py-1.5 text-sm rounded-md cursor-pointer transition-colors ${
        mode === value
          ? "bg-white dark:bg-neutral-600 shadow-sm font-medium"
          : "text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100"
      }`}
      aria-pressed={mode === value}
      onClick={() => switchTo(value)}
    >
      {label}
    </button>
  );

  return (
    <div class="space-y-4">
      <div class="flex gap-1 p-1 rounded-lg bg-neutral-200/70 dark:bg-white/[0.06]">
        {modeButton("compose", t("settings.boardBackground.mode.compose"))}
        {modeButton("picture", t("settings.boardBackground.picture"))}
      </div>

      {mode === "compose" ? (
        <div class="space-y-6">
          <section class="space-y-3">
            <SettingsHeading>
              {t("settings.boardBackground.color")}
            </SettingsHeading>
            <fieldset
              aria-label={t("settings.boardBackground.color")}
              class="flex flex-wrap gap-2 sm:gap-2.5"
            >
              {(["none", ...BOARD_NEUTRALS, ...BOARD_COLORS] as const).map(
                (choice) => (
                  <button
                    key={choice}
                    type="button"
                    data-board-swatch={choice}
                    class={`board-swatch w-6 h-6 sm:w-7 sm:h-7 rounded-full cursor-pointer flex items-center justify-center ${ringClass} ${composing && color === choice ? selectedClass : ""}`}
                    onClick={() =>
                      compose(() => {
                        boardColor.value = choice;
                      })
                    }
                    aria-label={boardColorLabel(choice)}
                    aria-pressed={composing && color === choice}
                    title={boardColorLabel(choice)}
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
                  color === "random" ? resolvedBoardColor.value : "none"
                }
                class={`board-swatch w-6 h-6 sm:w-7 sm:h-7 rounded-full cursor-pointer flex items-center justify-center ${ringClass} ${composing && color === "random" ? selectedClass : ""}`}
                onClick={() =>
                  compose(() => {
                    // Picking "random" again is how to ask for another.
                    if (color === "random") rerollBoardColor();
                    boardColor.value = "random";
                  })
                }
                aria-label={boardColorLabel("random")}
                aria-pressed={composing && color === "random"}
                title={boardColorLabel("random")}
              >
                <Shuffle class="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
              </button>
              <span
                aria-hidden="true"
                class="self-center w-px h-5 mx-0.5 bg-neutral-300 dark:bg-white/15"
              />
              {/* The native picker, under a swatch that shows what it holds.
                      The rainbow rim is what says "any colour" before one is set. */}
              <label
                class={`relative w-6 h-6 sm:w-7 sm:h-7 rounded-full cursor-pointer p-[3px] bg-[conic-gradient(#f87171,#facc15,#4ade80,#38bdf8,#a78bfa,#f472b6,#f87171)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-500 ${composing && color === "custom" ? selectedClass : ""}`}
                title={boardColorLabel("custom")}
              >
                <span
                  data-board-swatch="custom"
                  class="board-swatch block w-full h-full rounded-full"
                />
                <input
                  type="color"
                  class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  value={boardCustomColor.value}
                  aria-label={boardColorLabel("custom")}
                  onClick={() =>
                    compose(() => {
                      boardColor.value = "custom";
                    })
                  }
                  onInput={(e) =>
                    compose(() => {
                      boardCustomColor.value = e.currentTarget.value;
                      boardColor.value = "custom";
                    })
                  }
                />
              </label>
            </fieldset>

            <BoardGradientPicker composing={composing} compose={compose} />
          </section>

          <section class="space-y-4">
            <SettingsHeading>
              {t("settings.boardBackground.texture")}
            </SettingsHeading>
            <fieldset
              aria-label={t("settings.boardBackground.texture")}
              class="grid grid-cols-4 sm:grid-cols-6 gap-2"
            >
              {[...BOARD_TEXTURES, "random" as const].map((choice) => (
                <button
                  key={choice}
                  type="button"
                  class="flex flex-col items-stretch gap-1 text-[11px] leading-tight text-neutral-600 dark:text-neutral-300 cursor-pointer"
                  onClick={() =>
                    compose(() => {
                      // Picking "random" again is how to ask for another.
                      if (choice === "random" && texture === "random") {
                        rerollBoardTexture();
                      }
                      boardTexture.value = choice;
                    })
                  }
                  aria-pressed={composing && texture === choice}
                >
                  <span
                    aria-hidden="true"
                    data-texture={
                      choice !== "random"
                        ? choice
                        : texture === "random"
                          ? resolvedBoardTexture.value
                          : "none"
                    }
                    class={`board-texture-tile flex items-center justify-center h-10 rounded-md ${ringClass} ${composing && texture === choice ? selectedClass : ""}`}
                  >
                    {choice === "none" && (
                      <Ban class="w-4 h-4 text-neutral-400 dark:text-neutral-500" />
                    )}
                    {choice === "random" && (
                      <Shuffle class="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                    )}
                  </span>
                  {textureLabel(choice)}
                </button>
              ))}
            </fieldset>

            <BoardInkPicker composing={composing} compose={compose} />

            <BoardOpacitySlider compose={compose} />
          </section>
        </div>
      ) : hasPicture ? (
        <div class="space-y-3">
          <span
            aria-hidden="true"
            class={`block w-full aspect-[16/9] max-h-44 rounded-lg bg-cover bg-center bg-neutral-200 dark:bg-neutral-700 ${ringClass}`}
            style={
              boardImageUrl.value
                ? { backgroundImage: `url("${boardImageUrl.value}")` }
                : undefined
            }
          />
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg cursor-pointer transition-colors bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600"
              onClick={() => pictureInputRef.current?.click()}
            >
              <ImagePlus class="w-4 h-4 shrink-0" />
              {t("settings.boardBackground.replace")}
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg cursor-pointer transition-colors text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
              onClick={() => void removeBoardImage()}
            >
              <Trash2 class="w-4 h-4 shrink-0" />
              {t("settings.boardBackground.remove")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          class="flex w-full flex-col items-center justify-center gap-1.5 py-6 rounded-lg border-2 border-dashed border-neutral-300 dark:border-neutral-600 text-sm text-neutral-600 dark:text-neutral-300 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-700/40"
          onClick={() => pictureInputRef.current?.click()}
        >
          <ImagePlus class="w-5 h-5" />
          {t("settings.boardBackground.choose")}
        </button>
      )}
      <input
        ref={pictureInputRef}
        type="file"
        accept="image/*"
        class="hidden"
        onChange={(e) => {
          const input = e.currentTarget;
          const file = input.files?.[0];
          input.value = "";
          if (file) void setBoardImage(file);
        }}
      />
    </div>
  );
}
