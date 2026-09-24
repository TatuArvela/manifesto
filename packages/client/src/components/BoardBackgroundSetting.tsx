import { Ban, ChevronDown, ImagePlus, Shuffle, Trash2 } from "lucide-preact";
import { useRef, useState } from "preact/hooks";
import { t } from "../i18n/index.js";
import {
  boardImageUrl,
  removeBoardImage,
  setBoardImage,
} from "../state/board.js";
import {
  BOARD_COLORS,
  BOARD_TEXTURES,
  type BoardColorChoice,
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
} from "../state/index.js";

const ringClass = "ring-1 ring-inset ring-black/10 dark:ring-white/15";
const selectedClass =
  "outline-2 outline-offset-2 outline-blue-500 dark:outline-blue-400";

const legendClass =
  "text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2";

/**
 * The board as it stands, in miniature: the picture when it covers the board,
 * otherwise the colour with the texture on it.
 */
function BoardPreview({ class: className }: { class: string }) {
  const picture = boardUsePicture.value ? boardImageUrl.value : null;
  if (picture) {
    return (
      <span
        aria-hidden="true"
        class={`${className} ${ringClass} bg-cover bg-center`}
        style={{ backgroundImage: `url("${picture}")` }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-texture={resolvedBoardTexture.value}
      class={`board-texture-tile ${className} ${ringClass}`}
    />
  );
}

function colorLabel(color: BoardColorChoice): string {
  return t(`settings.boardBackground.${color}`);
}

function textureLabel(texture: BoardTextureChoice): string {
  return t(`settings.boardBackground.texture.${texture}`);
}

/**
 * Settings > Appearance > Board Background: the rows of that group, a
 * summary that folds open in place into the composer. The board has two kinds of background, and the
 * card says which one it is composing: a colour with a texture drawn over it,
 * or a picture of the user's own that covers the whole board instead. Every
 * choice applies at once, to the board visible behind the modal.
 */
export function BoardBackgroundSetting() {
  const [expanded, setExpanded] = useState(false);
  const pictureInputRef = useRef<HTMLInputElement>(null);
  const hasPicture = boardImageStamp.value > 0;
  const showingPicture = boardUsePicture.value && hasPicture;
  // Which kind the card shows. The picture tab can be open with no picture
  // yet, to choose one, while the board keeps its colour.
  const [mode, setMode] = useState<"compose" | "picture">(
    showingPicture ? "picture" : "compose",
  );
  const color = boardColor.value;
  const texture = boardTexture.value;

  const summary = showingPicture
    ? t("settings.boardBackground.picture")
    : color === "none" && texture === "none"
      ? t("settings.boardBackground.none")
      : texture === "none"
        ? colorLabel(color)
        : color === "none"
          ? textureLabel(texture)
          : t("settings.boardBackground.summary", {
              color: colorLabel(color),
              texture: textureLabel(texture),
            });

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
    <>
      <button
        type="button"
        class={`flex w-full items-center gap-3 px-3 py-2 min-h-12 text-left cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800/60 ${expanded ? "rounded-t-xl" : "rounded-xl"}`}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="board-background-composer"
        aria-label={`${t("settings.boardBackground")}: ${summary}`}
      >
        <BoardPreview class="w-12 h-8 shrink-0 rounded-md" />
        <span class="flex-1 min-w-0 text-sm text-neutral-700 dark:text-neutral-200 truncate">
          {summary}
        </span>
        <ChevronDown
          class={`w-4 h-4 shrink-0 text-neutral-500 dark:text-neutral-400 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div
          id="board-background-composer"
          class="rounded-b-xl bg-neutral-200/50 dark:bg-black/25 shadow-[inset_0_2px_4px_rgb(0_0_0/0.06)] dark:shadow-[inset_0_2px_4px_rgb(0_0_0/0.3)] p-3 space-y-4"
        >
          <div class="flex gap-1 p-1 rounded-lg bg-neutral-300/50 dark:bg-white/[0.06]">
            {modeButton("compose", t("settings.boardBackground.mode.compose"))}
            {modeButton("picture", t("settings.boardBackground.picture"))}
          </div>

          {mode === "compose" ? (
            <>
              <fieldset>
                <legend class={legendClass}>
                  {t("settings.boardBackground.color")}
                </legend>
                <div class="flex flex-wrap gap-2.5">
                  {(["none", ...BOARD_COLORS] as const).map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      data-board-swatch={choice}
                      class={`board-swatch w-7 h-7 rounded-full cursor-pointer flex items-center justify-center ${ringClass} ${composing && color === choice ? selectedClass : ""}`}
                      onClick={() =>
                        compose(() => {
                          boardColor.value = choice;
                        })
                      }
                      aria-label={colorLabel(choice)}
                      aria-pressed={composing && color === choice}
                      title={colorLabel(choice)}
                    >
                      {choice === "none" && (
                        <Ban class="w-4 h-4 text-neutral-400 dark:text-neutral-500" />
                      )}
                    </button>
                  ))}
                  {/* The native picker, under a swatch that shows what it holds.
                      The rainbow rim is what says "any colour" before one is set. */}
                  <label
                    class={`relative w-7 h-7 rounded-full cursor-pointer p-[3px] bg-[conic-gradient(#f87171,#facc15,#4ade80,#38bdf8,#a78bfa,#f472b6,#f87171)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-500 ${composing && color === "custom" ? selectedClass : ""}`}
                    title={colorLabel("custom")}
                  >
                    <span
                      data-board-swatch="custom"
                      class="board-swatch block w-full h-full rounded-full"
                    />
                    <input
                      type="color"
                      class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      value={boardCustomColor.value}
                      aria-label={colorLabel("custom")}
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
                  <button
                    type="button"
                    data-board-swatch={
                      color === "random" ? resolvedBoardColor.value : "none"
                    }
                    class={`board-swatch w-7 h-7 rounded-full cursor-pointer flex items-center justify-center ${ringClass} ${composing && color === "random" ? selectedClass : ""}`}
                    onClick={() =>
                      compose(() => {
                        // Picking "random" again is how to ask for another.
                        if (color === "random") rerollBoardColor();
                        boardColor.value = "random";
                      })
                    }
                    aria-label={colorLabel("random")}
                    aria-pressed={composing && color === "random"}
                    title={colorLabel("random")}
                  >
                    <Shuffle class="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                  </button>
                </div>
              </fieldset>

              <fieldset>
                {/* Floated, so the legend lays out as a line of its own that
                    the Random button can share, rather than in the border. */}
                <legend class={`${legendClass} float-left`}>
                  {t("settings.boardBackground.texture")}
                </legend>
                {/* Random is a way to pick, not a texture, so it sits by the
                    heading rather than among the tiles. */}
                <button
                  type="button"
                  class={`float-right -mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full cursor-pointer transition-colors ${
                    composing && texture === "random"
                      ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                      : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                  }`}
                  onClick={() =>
                    compose(() => {
                      // Picking "random" again is how to ask for another.
                      if (texture === "random") rerollBoardTexture();
                      boardTexture.value = "random";
                    })
                  }
                  aria-pressed={composing && texture === "random"}
                >
                  <Shuffle class="w-3.5 h-3.5" />
                  {textureLabel("random")}
                </button>
                <div class="clear-both grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {BOARD_TEXTURES.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      class="flex flex-col items-stretch gap-1 text-[11px] leading-tight text-neutral-600 dark:text-neutral-300 cursor-pointer"
                      onClick={() =>
                        compose(() => {
                          boardTexture.value = choice;
                        })
                      }
                      aria-pressed={composing && texture === choice}
                    >
                      <span
                        aria-hidden="true"
                        data-texture={choice}
                        class={`board-texture-tile block h-10 rounded-md ${ringClass} ${composing && texture === choice ? selectedClass : ""}`}
                      />
                      {textureLabel(choice)}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
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
      )}
    </>
  );
}
