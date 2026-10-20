import { Ban, ImagePlus, Shuffle, Trash2 } from "lucide-preact";
import { useRef, useState } from "preact/hooks";
import { t } from "#/i18n/index.ts";
import {
  boardImageUrl,
  removeBoardImage,
  setBoardImage,
} from "#/state/board.ts";
import {
  BOARD_TEXTURES,
  type BoardTextureChoice,
  boardColor,
  boardCustomColor,
  boardGradient,
  boardGradientCustomColor,
  boardImageStamp,
  boardTexture,
  boardUsePicture,
  rerollBoardColor,
  rerollBoardGradient,
  rerollBoardTexture,
  resolvedBoardColor,
  resolvedBoardGradient,
  resolvedBoardTexture,
} from "#/state/prefs.ts";
import { BoardCard } from "./BoardCard.tsx";
import { BoardInkPicker } from "./BoardInkPicker.tsx";
import { BoardOpacitySlider } from "./BoardOpacitySlider.tsx";
import { BoardPalette } from "./BoardPalette.tsx";
import { BoardPreview, BoardRerollButton } from "./BoardPreview.tsx";
import { boardColorLabel } from "./boardLabels.ts";
import { SettingsHeading } from "./SettingsControls.tsx";

const ringClass = "ring-1 ring-inset ring-black/10 dark:ring-white/15";
const selectedClass =
  "outline-2 outline-offset-2 outline-blue-500 dark:outline-blue-400";

/**
 * "none" and "random" first, where they are in each picker on the page, then
 * the patterns themselves.
 */
const TEXTURE_CHOICES: readonly BoardTextureChoice[] = [
  "none",
  "random",
  ...BOARD_TEXTURES.filter((texture) => texture !== "none"),
];

function textureLabel(texture: BoardTextureChoice): string {
  return t(`settings.boardBackground.texture.${texture}`);
}

/**
 * Settings > Board Background, a separate page. The board has two types of
 * background, and the page tells which one it makes: a color with a texture
 * drawn over it, or an own picture of the user that covers the full board in
 * place of that. Each choice applies immediately, to the board that shows
 * behind the modal.
 */
export function BoardBackgroundSettings() {
  const pictureInputRef = useRef<HTMLInputElement>(null);
  const hasPicture = boardImageStamp.value > 0;
  const showingPicture = boardUsePicture.value && hasPicture;
  // The type that the page shows. The picture tab can be open with no picture
  // yet, to select one, while the board keeps its color.
  const [mode, setMode] = useState<"compose" | "picture">(
    showingPicture ? "picture" : "compose",
  );
  const color = boardColor.value;
  const texture = boardTexture.value;

  /**
   * A selection of a color or a texture makes a composition. Thus, the picture
   * moves aside.
   */
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
            {/* As tall as the button, so it comes and goes without moving the page. */}
            <div class="flex items-center justify-between gap-2 min-h-7">
              <SettingsHeading>
                {t("settings.boardBackground.colors")}
              </SettingsHeading>
              <BoardRerollButton composing={composing} />
            </div>
            <div class="grid grid-cols-2 gap-2 sm:gap-3">
              <BoardPalette
                legend={t("settings.boardBackground.color")}
                value={color}
                selected={composing}
                noneLabel={boardColorLabel("none")}
                randomShows={resolvedBoardColor.value}
                customSwatch="custom"
                customValue={boardCustomColor.value}
                onPick={(choice) =>
                  compose(() => {
                    boardColor.value = choice;
                  })
                }
                onReroll={rerollBoardColor}
                onCustom={(hex) =>
                  compose(() => {
                    boardCustomColor.value = hex;
                    boardColor.value = "custom";
                  })
                }
              />
              <BoardPalette
                legend={t("settings.boardBackground.gradient")}
                value={boardGradient.value}
                selected={composing}
                noneLabel={t("settings.boardBackground.gradient.none")}
                randomShows={resolvedBoardGradient.value}
                customSwatch="gradient-custom"
                customValue={boardGradientCustomColor.value}
                onPick={(choice) =>
                  compose(() => {
                    boardGradient.value = choice;
                  })
                }
                onReroll={rerollBoardGradient}
                onCustom={(hex) =>
                  compose(() => {
                    boardGradientCustomColor.value = hex;
                    boardGradient.value = "custom";
                  })
                }
              />
            </div>
            <BoardPreview composing={composing} compose={compose} />
          </section>

          <section class="space-y-3">
            <SettingsHeading>
              {t("settings.boardBackground.texture")}
            </SettingsHeading>
            <div class="grid grid-cols-2 gap-2 sm:gap-3 items-start">
              {/* The tiles have no room for their names beside the colour, so
                  the card names the one chosen. */}
              <BoardCard
                legend={t("settings.boardBackground.texture")}
                detail={textureLabel(texture)}
              >
                <div class="grid grid-cols-3 gap-1.5 sm:gap-2">
                  {TEXTURE_CHOICES.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      data-texture={
                        choice !== "random"
                          ? choice
                          : texture === "random"
                            ? resolvedBoardTexture.value
                            : "none"
                      }
                      class={`board-texture-tile flex items-center justify-center h-9 sm:h-10 rounded-md cursor-pointer ${ringClass} ${composing && texture === choice ? selectedClass : ""}`}
                      onClick={() =>
                        compose(() => {
                          // A new selection of "random" is how to ask for a
                          // different one.
                          if (choice === "random" && texture === "random") {
                            rerollBoardTexture();
                          }
                          boardTexture.value = choice;
                        })
                      }
                      aria-label={textureLabel(choice)}
                      aria-pressed={composing && texture === choice}
                      title={textureLabel(choice)}
                    >
                      {choice === "none" && (
                        <Ban class="w-4 h-4 text-neutral-400 dark:text-neutral-500" />
                      )}
                      {choice === "random" && (
                        <Shuffle class="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                      )}
                    </button>
                  ))}
                </div>
              </BoardCard>
              <div class="space-y-2 sm:space-y-3 min-w-0">
                <BoardInkPicker
                  composing={composing}
                  compose={compose}
                  disabled={resolvedBoardTexture.value === "none"}
                />
                <BoardOpacitySlider compose={compose} />
              </div>
            </div>
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
