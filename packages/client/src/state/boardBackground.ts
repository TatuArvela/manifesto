import { batch, computed, effect, signal } from "@preact/signals";
import { inkHex } from "#/utils/boardInk.ts";
import { pictureTextures, sheetTextures } from "#/utils/boardTextures.ts";
import {
  BOARD_COLORS,
  BOARD_GRADIENT_DIRECTIONS,
  type BoardColor,
  type BoardColorChoice,
  type BoardGradientChoice,
  type BoardGradientDirection,
  type BoardInk,
  type BoardTexture,
  pickOne,
  rollBoardColor,
  rollBoardTexture,
} from "./prefParsers.ts";
import {
  animations,
  boardColor,
  boardCustomColor,
  boardGradient,
  boardGradientCustomColor,
  boardGradientDirection,
  boardGradientSpeed,
  boardInk,
  boardInkColor,
  boardTexture,
  boardTextureOpacity,
  boardTextureSpeed,
} from "./prefs.ts";

// The board background as it is drawn: each "random" choice resolved for this
// tab, the rerolls, and the attributes and custom properties on <html> from
// which the stylesheets draw the board (styles/board-background.css,
// styles/board-motion.css). The preferences themselves are in `prefs.ts`.

/** The preset that "random" means in this tab. See `randomBoardTexture`. */
const randomBoardColor = signal<BoardColor>(rollBoardColor());

/** The color choice that is really on the board, with "random" resolved. */
export const resolvedBoardColor = computed<Exclude<BoardColorChoice, "random">>(
  () =>
    boardColor.value === "random" ? randomBoardColor.value : boardColor.value,
);

/** Selects a different random color, never the color that shows now. */
export function rerollBoardColor() {
  const current = randomBoardColor.peek();
  let next = rollBoardColor();
  while (next === current) next = rollBoardColor();
  randomBoardColor.value = next;
}
/**
 * The texture that "random" means in this tab. Selected one time for each page
 * load. Thus, the board changes between visits, but never under the user during
 * a session. `rerollBoardTexture` selects again. Not persisted, because a new
 * selection is the purpose.
 */
const randomBoardTexture = signal<BoardTexture>(rollBoardTexture());

/** The texture that is really on the board, with "random" resolved. */
export const resolvedBoardTexture = computed<BoardTexture>(() =>
  boardTexture.value === "random"
    ? randomBoardTexture.value
    : boardTexture.value,
);

/** Selects a different random texture, never the texture that shows now. */
export function rerollBoardTexture() {
  const current = randomBoardTexture.peek();
  let next = rollBoardTexture();
  while (next === current) next = rollBoardTexture();
  randomBoardTexture.value = next;
}

/**
 * A preset for the "random" of the gradient, never the own color of the board.
 */
function rollBoardGradient(except: string | undefined): BoardColor {
  const color = resolvedBoardColor.peek();
  const first = color === "none" || color === "custom" ? undefined : color;
  let next = rollBoardColor(first);
  while (next === except) next = rollBoardColor(first);
  return next;
}

/**
 * The preset that the "random" of the gradient means in this tab. Selected as
 * `randomBoardColor` is, and never the same as it. If it were, the board would
 * be flat.
 */
const randomBoardGradient = signal<BoardColor>(rollBoardGradient(undefined));

/** The color to which the board really fades, with "random" resolved. */
export const resolvedBoardGradient = computed<
  Exclude<BoardGradientChoice, "random">
>(() =>
  boardGradient.value === "random"
    ? randomBoardGradient.value
    : boardGradient.value,
);

/**
 * Selects a different random gradient color, never the color that shows now.
 */
export function rerollBoardGradient() {
  randomBoardGradient.value = rollBoardGradient(randomBoardGradient.peek());
}

/**
 * The colorful preset that the "random" of the pattern color means in this tab.
 */
const randomBoardInk = signal<BoardColor>(pickOne(BOARD_COLORS));

/** The pattern color that is really drawn, with "random" resolved. */
export const resolvedBoardInk = computed<Exclude<BoardInk, "random">>(() =>
  boardInk.value === "random" ? randomBoardInk.value : boardInk.value,
);

/** Selects a different random pattern color, never the color that shows now. */
export function rerollBoardInk() {
  const current = randomBoardInk.peek();
  randomBoardInk.value = pickOne(
    BOARD_COLORS.filter((color) => color !== current),
  );
}

/** The direction that "random" means in this tab. */
const randomBoardGradientDirection = signal<BoardGradientDirection>(
  pickOne(BOARD_GRADIENT_DIRECTIONS),
);

/** The direction in which the board really fades, with "random" resolved. */
export const resolvedBoardGradientDirection = computed<BoardGradientDirection>(
  () =>
    boardGradientDirection.value === "random"
      ? randomBoardGradientDirection.value
      : boardGradientDirection.value,
);

/** Selects a different random direction, never the direction that shows now. */
export function rerollBoardGradientDirection() {
  const current = randomBoardGradientDirection.peek();
  randomBoardGradientDirection.value = pickOne(
    BOARD_GRADIENT_DIRECTIONS.filter((way) => way !== current),
  );
}

/**
 * The choices of the board set to "random" that show now, as the reroll of
 * each. A direction counts only with a gradient to point. A pattern color
 * counts only with a pattern to draw in it. The color comes before the
 * gradient, which selects a value different from it.
 */
export const boardRerolls = computed<readonly (() => void)[]>(() => {
  const rerolls: (() => void)[] = [];
  if (boardColor.value === "random") rerolls.push(rerollBoardColor);
  if (boardGradient.value === "random") rerolls.push(rerollBoardGradient);
  if (
    boardGradient.value !== "none" &&
    boardGradientDirection.value === "random"
  ) {
    rerolls.push(rerollBoardGradientDirection);
  }
  if (boardTexture.value === "random") rerolls.push(rerollBoardTexture);
  if (resolvedBoardTexture.value !== "none" && boardInk.value === "random") {
    rerolls.push(rerollBoardInk);
  }
  return rerolls;
});

/** Selects again for each choice of the board that is set to "random". */
export function rerollBoardBackground() {
  batch(() => {
    for (const reroll of boardRerolls.peek()) reroll();
  });
}

// --- Board background ---

// Attributes on <html>. The stylesheet sets the color and
// texture of the board from them, in both themes. A custom color goes as
// `--board-custom`, which the dark theme makes darker. The second custom color
// of the gradient goes in the same way. state/board.ts applies the picture,
// which covers both.
effect(() => {
  const root = document.documentElement;
  const color = resolvedBoardColor.value;
  const texture = resolvedBoardTexture.value;
  if (color === "none") delete root.dataset.boardColor;
  else root.dataset.boardColor = color;
  if (texture === "none") delete root.dataset.boardTexture;
  else root.dataset.boardTexture = texture;
  root.style.setProperty("--board-custom", boardCustomColor.value);
  const gradient = resolvedBoardGradient.value;
  if (gradient === "none") {
    delete root.dataset.boardGradient;
    delete root.dataset.boardGradientDirection;
  } else {
    root.dataset.boardGradient = gradient;
    root.dataset.boardGradientDirection = resolvedBoardGradientDirection.value;
  }
  // The swatch of the custom pattern color in Settings shows it.
  root.style.setProperty("--board-ink-custom", boardInkColor.value);
  root.style.setProperty(
    "--board-gradient-custom",
    boardGradientCustomColor.value,
  );
});

// The color and opacity of the pattern, which the texture layer behind the
// board takes as they are (`.board-frame::before` in board-background.css). A
// change of either draws nothing again. "auto" keeps the own ink of the theme,
// black or white.
effect(() => {
  const root = document.documentElement;
  const ink = resolvedBoardInk.value;
  if (ink === "auto") delete root.dataset.boardInk;
  else {
    root.dataset.boardInk = "";
    root.style.setProperty(
      "--board-ink-picked",
      inkHex(ink, boardInkColor.value),
    );
  }
  root.style.setProperty(
    "--board-texture-opacity",
    String(boardTextureOpacity.value / 100),
  );
});

// The motion of the board. Set only while the animations are on. Thus, with them
// off, or with the reduced-motion setting of the OS on the first run, the board
// has no moving layer at all, and shows its usual still gradient and texture.
/** If the gradient rolls: the frame and the preview get the rolling layer. */
export const boardGradientMoves = computed(
  () =>
    animations.value &&
    boardGradientSpeed.value > 0 &&
    resolvedBoardGradient.value !== "none",
);
/** If the pattern moves: the board and the tiles show it in its sheets. */
export const boardTextureMoves = computed(
  () => animations.value && boardTextureSpeed.value > 0,
);

effect(() => {
  const root = document.documentElement;
  if (boardGradientMoves.value) root.dataset.boardRoll = "";
  else delete root.dataset.boardRoll;
  if (boardTextureMoves.value) root.dataset.boardTextureMotion = "";
  else delete root.dataset.boardTextureMotion;
});

/**
 * The rate at which a board animation plays, from its name (board-motion.css),
 * or null for an animation that is not of the board. 100% is the time that the
 * stylesheet gives it.
 */
function boardPace(
  name: string,
  gradientSpeed: number,
  textureSpeed: number,
): number | null {
  if (name.startsWith("board-roll")) return gradientSpeed / 100;
  if (name.startsWith("board-sheet")) return textureSpeed / 100;
  return null;
}

/**
 * The speed is the rate of the running animations, not their duration. A new
 * duration puts each layer at a different point of its loop, and the board
 * jumps on each step of the slider. A new rate keeps the point where it is.
 */
function paceBoardAnimations(
  running: readonly Animation[],
  gradientSpeed: number,
  textureSpeed: number,
) {
  for (const animation of running) {
    if (!(animation instanceof CSSAnimation)) continue;
    const pace = boardPace(
      animation.animationName,
      gradientSpeed,
      textureSpeed,
    );
    if (pace !== null && pace > 0 && animation.playbackRate !== pace) {
      animation.playbackRate = pace;
    }
  }
}

effect(() => {
  paceBoardAnimations(
    document.getAnimations(),
    boardGradientSpeed.value,
    boardTextureSpeed.value,
  );
});

// A layer that starts (a tile in Settings, a new texture, the roll when a
// gradient comes back) plays at the rate of the stylesheet until it gets its
// own. The event comes in the frame after it starts. Thus, it moves for one
// frame at that rate, which does not show. Each layer that starts sends its own
// event, and Settings starts many together. Thus, each event paces only the
// animations of its own element (with those of its pseudo-elements), not all of
// the document.
document.addEventListener("animationstart", (event) => {
  const gradientSpeed = boardGradientSpeed.peek();
  const textureSpeed = boardTextureSpeed.peek();
  const target = event.target;
  if (
    target instanceof Element &&
    boardPace(event.animationName, gradientSpeed, textureSpeed) !== null
  ) {
    paceBoardAnimations(
      target
        .getAnimations({ subtree: true })
        .filter(
          (animation) =>
            animation.effect instanceof KeyframeEffect &&
            animation.effect.target === target,
        ),
      gradientSpeed,
      textureSpeed,
    );
  }
});

// The picture textures, as masks that the layer reads as it reads the gradient
// masks. Only their shape is important. Thus, they are drawn one time, at load.
for (const [name, image] of Object.entries(pictureTextures())) {
  document.documentElement.style.setProperty(
    `--board-texture-${name}-mask`,
    image,
  );
}
// The sheets of the moving patterns, drawn in the same way (BoardSheets.tsx).
for (const [name, images] of Object.entries(sheetTextures())) {
  for (const [k, image] of images.entries()) {
    document.documentElement.style.setProperty(
      `--board-sheet-${name}-${k}`,
      image,
    );
  }
}
