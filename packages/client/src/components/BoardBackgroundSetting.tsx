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
  // Held through the fold closing, so the composer stays drawn (and the row
  // keeps its square bottom corners) until it has folded away.
  const [open, setOpen] = useState(false);
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
        class={`flex w-full items-center gap-3 px-3 py-2 min-h-12 text-left border-b-0 cursor-pointer bg-neutral-100/70 dark:bg-white/[0.05] hover:bg-neutral-200/60 dark:hover:bg-white/[0.08] ${open ? "rounded-t-xl" : "rounded-xl"}`}
        onClick={() => {
          if (!expanded) setOpen(true);
          setExpanded(!expanded);
        }}
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

      {/* Folds by animating the row from 0fr to 1fr, which moves to the
          content's own height without measuring it. */}
      <div
        id="board-background-composer"
        class={`grid transition-[grid-template-rows] duration-200 ease-out ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        inert={!expanded}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && !expanded) setOpen(false);
        }}
      >
        <div class="min-h-0 overflow-hidden">
          {open && (
            <div class="mb-2 rounded-b-xl bg-neutral-100/70 dark:bg-white/[0.05] p-3 space-y-4">
              <div class="flex gap-1 p-1 rounded-lg bg-neutral-200/70 dark:bg-white/[0.06]">
                {modeButton(
                  "compose",
                  t("settings.boardBackground.mode.compose"),
                )}
                {modeButton("picture", t("settings.boardBackground.picture"))}
              </div>

              {mode === "compose" ? (
                <>
                  <fieldset>
                    <legend class={legendClass}>
                      {t("settings.boardBackground.color")}
                    </legend>
                    <div class="flex flex-wrap gap-2 sm:gap-2.5">
                      {(["none", ...BOARD_COLORS] as const).map((choice) => (
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
                          aria-label={colorLabel(choice)}
                          aria-pressed={composing && color === choice}
                          title={colorLabel(choice)}
                        >
                          {choice === "none" && (
                            <Ban class="w-4 h-4 text-neutral-400 dark:text-neutral-500" />
                          )}
                        </button>
                      ))}
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
                        aria-label={colorLabel("random")}
                        aria-pressed={composing && color === "random"}
                        title={colorLabel("random")}
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
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend class={legendClass}>
                      {t("settings.boardBackground.texture")}
                    </legend>
                    <div class="grid grid-cols-4 sm:grid-cols-6 gap-2">
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
        </div>
      </div>
    </>
  );
}
