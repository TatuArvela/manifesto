import { Ban, ChevronDown, ImagePlus, Trash2 } from "lucide-preact";
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
  type BoardTexture,
  boardColor,
  boardCustomColor,
  boardImageStamp,
  boardTexture,
  boardUsePicture,
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
      data-texture={boardTexture.value}
      class={`board-texture-tile ${className} ${ringClass}`}
    />
  );
}

function colorLabel(color: BoardColorChoice): string {
  return t(`settings.boardBackground.${color}`);
}

function textureLabel(texture: BoardTexture): string {
  return t(`settings.boardBackground.texture.${texture}`);
}

/**
 * Settings > Appearance > Board Background. Folds open in place into the
 * composition: a colour, a texture drawn over it, or a picture of the user's
 * own that covers the whole board instead. Every choice applies at once, to
 * the board visible beside the panel.
 */
export function BoardBackgroundSetting() {
  const [expanded, setExpanded] = useState(false);
  const pictureInputRef = useRef<HTMLInputElement>(null);
  const hasPicture = boardImageStamp.value > 0;
  const showingPicture = boardUsePicture.value && hasPicture;
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

  return (
    <div>
      <div class="flex items-center justify-between gap-4">
        <h4 class="text-sm text-neutral-600 dark:text-neutral-400">
          {t("settings.boardBackground")}
        </h4>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 pl-2 pr-2 py-1.5 text-sm rounded-lg cursor-pointer transition-colors bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls="board-background-composer"
          aria-label={`${t("settings.boardBackground")}: ${summary}`}
        >
          <BoardPreview class="w-9 h-5 shrink-0 rounded" />
          <span>{summary}</span>
          <ChevronDown
            class={`w-4 h-4 shrink-0 text-neutral-500 dark:text-neutral-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {expanded && (
        <div id="board-background-composer" class="mt-3 space-y-4">
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
            </div>
          </fieldset>

          <fieldset>
            <legend class={legendClass}>
              {t("settings.boardBackground.texture")}
            </legend>
            <div class="grid grid-cols-4 gap-2">
              {BOARD_TEXTURES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  class="flex flex-col items-stretch gap-1 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer"
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
                    class={`board-texture-tile block aspect-[4/3] rounded-md ${ringClass} ${composing && texture === choice ? selectedClass : ""}`}
                  />
                  {textureLabel(choice)}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend class={legendClass}>
              {t("settings.boardBackground.picture")}
            </legend>
            <div class="flex items-center gap-3">
              {hasPicture && (
                <button
                  type="button"
                  class={`w-20 aspect-[4/3] shrink-0 rounded-md cursor-pointer bg-cover bg-center bg-neutral-200 dark:bg-neutral-700 ${ringClass} ${showingPicture ? selectedClass : ""}`}
                  style={
                    boardImageUrl.value
                      ? { backgroundImage: `url("${boardImageUrl.value}")` }
                      : undefined
                  }
                  onClick={() => {
                    boardUsePicture.value = !boardUsePicture.value;
                  }}
                  aria-pressed={showingPicture}
                  aria-label={t("settings.boardBackground.usePicture")}
                />
              )}
              <div class="flex flex-col items-start gap-1">
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg cursor-pointer transition-colors bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600"
                  onClick={() => pictureInputRef.current?.click()}
                >
                  <ImagePlus class="w-4 h-4 shrink-0" />
                  {hasPicture
                    ? t("settings.boardBackground.replace")
                    : t("settings.boardBackground.choose")}
                </button>
                {hasPicture && (
                  <button
                    type="button"
                    class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg cursor-pointer transition-colors text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                    onClick={() => void removeBoardImage()}
                  >
                    <Trash2 class="w-4 h-4 shrink-0" />
                    {t("settings.boardBackground.remove")}
                  </button>
                )}
              </div>
            </div>
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
          </fieldset>
        </div>
      )}
    </div>
  );
}
