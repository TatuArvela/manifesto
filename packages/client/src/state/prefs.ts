import { NoteColor, NoteFont } from "@manifesto/shared";
import {
  batch,
  computed,
  effect,
  type Signal,
  signal,
  untracked,
} from "@preact/signals";
import { inkHex, pictureTextures } from "#/utils/boardTextures.ts";
import {
  ACCOUNT_PREF_KEYS,
  BOARD_COLORS,
  BOARD_GRADIENT_DIRECTIONS,
  type BoardColor,
  type BoardColorChoice,
  type BoardGradientChoice,
  type BoardGradientDirection,
  type BoardInk,
  type BoardTexture,
  type LoadedPrefs,
  PREF_KEYS,
  PREF_PARSERS,
  type PrefKey,
  parsePrefs,
  pickOne,
  rollBoardColor,
  rollBoardTexture,
  type ThemeMode,
} from "./prefParsers.ts";
import { serverDefaultPrefs } from "./serverDefaults.ts";

export type {
  BoardColor,
  BoardColorChoice,
  BoardGradientChoice,
  BoardGradientDirection,
  BoardGradientDirectionChoice,
  BoardInk,
  BoardNeutral,
  BoardTexture,
  BoardTextureChoice,
  DarkHue,
  DecimalSeparator,
  DefaultNoteColor,
  DefaultNoteFont,
  EditMode,
  LightHue,
  LoadedPrefs,
  NoteCorners,
  NoteScale,
  NoteSize,
  SortMode,
  TagColor,
  ThemeMode,
  ViewMode,
} from "./prefParsers.ts";
export {
  ACCOUNT_PREF_KEYS,
  BOARD_COLORS,
  BOARD_GRADIENT_DIRECTIONS,
  BOARD_INKS,
  BOARD_NEUTRALS,
  BOARD_TEXTURES,
  DARK_HUES,
  DEFAULT_BOARD_CUSTOM_COLOR,
  LIGHT_HUES,
  MAX_TAG_COLORS,
  parsePrefs,
} from "./prefParsers.ts";

// --- Persisted preferences ---

const PREFS_KEY = "manifesto:prefs";

function loadPrefs(): LoadedPrefs {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return parsePrefs(null);
  }
}

/** If this browser had no preferences of its own when the page loaded. */
const freshDevice = (() => {
  try {
    return localStorage.getItem(PREFS_KEY) === null;
  } catch {
    return false;
  }
})();

const loaded = loadPrefs();
const prefSignals: Partial<Record<PrefKey, Signal<unknown>>> = {};

/** The signal for one preference, registered for save and adoption. */
function pref<K extends PrefKey>(key: K): Signal<LoadedPrefs[K]> {
  const s = signal(loaded[key]);
  prefSignals[key] = s as Signal<unknown>;
  return s;
}

export const viewMode = pref("viewMode");
export const noteSize = pref("noteSize");
export const noteScale = pref("noteScale");
export const sortMode = pref("sortMode");
export const theme = pref("theme");
export const defaultNoteColor = pref("defaultNoteColor");
export const defaultNoteFont = pref("defaultNoteFont");
export const locale = pref("locale");
export const inlineCalculations = pref("inlineCalculations");
export const decimalSeparator = pref("decimalSeparator");
export const noteCorners = pref("noteCorners");
export const noteTilt = pref("noteTilt");
export const complexShadows = pref("complexShadows");
export const animations = pref("animations");
export const lightHue = pref("lightHue");
export const darkHue = pref("darkHue");
export const noteQuips = pref("noteQuips");
export const formattingToolbar = pref("formattingToolbar");
export const checkedItemsLast = pref("checkedItemsLast");
export const checklistProgress = pref("checklistProgress");
export const linkPreviewCards = pref("linkPreviewCards");
export const openLinksInBrowser = pref("openLinksInBrowser");
export const stickyTopBar = pref("stickyTopBar");
export const hiddenTags = pref("hiddenTags");
export const tagColors = pref("tagColors");
export const confirmBeforeDelete = pref("confirmBeforeDelete");
export const defaultEditMode = pref("defaultEditMode");
export const boardColor = pref("boardColor");
export const boardCustomColor = pref("boardCustomColor");
export const boardGradient = pref("boardGradient");
export const boardGradientCustomColor = pref("boardGradientCustomColor");
export const boardGradientDirection = pref("boardGradientDirection");
export const boardTexture = pref("boardTexture");
export const boardInk = pref("boardInk");
export const boardInkColor = pref("boardInkColor");
export const boardTextureOpacity = pref("boardTextureOpacity");
export const boardUsePicture = pref("boardUsePicture");
export const boardImageStamp = pref("boardImageStamp");

for (const key of PREF_KEYS) {
  if (!prefSignals[key]) throw new Error(`Preference "${key}" has no signal`);
}

function prefSignal(key: PrefKey): Signal<unknown> {
  return prefSignals[key] as Signal<unknown>;
}

/**
 * Never throws. When storage refuses (a private window, a full quota), the
 * signals keep the preferences for this session.
 */
function savePrefs() {
  const blob: Record<string, unknown> = {};
  for (const key of PREF_KEYS) blob[key] = prefSignal(key).value;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(blob));
  } catch {
    // Kept only in memory.
  }
}

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

/**
 * Returns the concrete decimal separator. Resolves "auto" through the current
 * locale.
 */
export function resolvedDecimalSeparator(): "." | "," {
  if (decimalSeparator.value !== "auto") return decimalSeparator.value;
  return locale.value === "fi" ? "," : ".";
}

const RANDOM_NOTE_COLORS = Object.values(NoteColor).filter(
  (c) => c !== NoteColor.Default,
);
const RANDOM_NOTE_FONTS = Object.values(NoteFont).filter(
  (f) => f !== NoteFont.Default,
);

/** The color that a new note gets, with "random" resolved. */
export function pickDefaultColor(): NoteColor {
  const choice = defaultNoteColor.value;
  return choice === "random" ? pickOne(RANDOM_NOTE_COLORS) : choice;
}

/** The font that a new note gets, with "random" resolved. */
export function pickDefaultFont(): NoteFont {
  const choice = defaultNoteFont.value;
  return choice === "random" ? pickOne(RANDOM_NOTE_FONTS) : choice;
}

/**
 * True while the preferences of a different tab are applied. Each pref is
 * written back as one blob. Thus, a tab that adopts a remote change and then
 * saves would send the same content around again. Worse, a tab that never
 * adopted it would write its own stale copy over the change on the next
 * unrelated toggle. Change the theme in one tab, change the view mode in a
 * different tab, and the theme is back.
 */
let applyingRemotePrefs = false;

/**
 * If the preferences of the account come from the server (`prefsSync.ts`, while
 * signed in). Each tab then gets each change on its own socket. Thus, the code
 * takes the blob of a different tab only for the preferences of the device.
 * When the code took it fully, it put back a value that this tab had just
 * changed. The other tab saves each time it adopts the copy of the server, and
 * a late echo there of an earlier change carries the value from before.
 */
let accountPrefsFromServer = false;

export function setAccountPrefsFromServer(on: boolean): void {
  accountPrefsFromServer = on;
}

const DEVICE_PREF_KEYS = PREF_KEYS.filter(
  (key) => !ACCOUNT_PREF_KEYS.includes(key),
);

/** Adopts a preferences blob that a different tab wrote. */
function applyPrefs(next: LoadedPrefs) {
  const keys = accountPrefsFromServer ? DEVICE_PREF_KEYS : PREF_KEYS;
  applyingRemotePrefs = true;
  try {
    batch(() => {
      for (const key of keys) prefSignal(key).value = next[key];
    });
  } finally {
    applyingRemotePrefs = false;
  }
}

/**
 * If the change in progress came from a different place: a different tab, or
 * the preferences of the account on the server. `prefsSync.ts` sends neither
 * on.
 */
export function isApplyingRemotePrefs(): boolean {
  return applyingRemotePrefs;
}

/** Each preference as it is here, for an open-mode export. */
export function prefsSnapshot(): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const key of PREF_KEYS) snapshot[key] = prefSignal(key).value;
  return snapshot;
}

/** The preferences of the account as they are here, for the server. */
export function accountPrefsSnapshot(): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const key of ACCOUNT_PREF_KEYS) {
    snapshot[key] = prefSignal(key as PrefKey).value;
  }
  return snapshot;
}

/**
 * Adopts the preferences of the account from the server: each key that is
 * there, read by its parser as a manually edited blob would be, because a
 * different client wrote it. The code does not change a key that the server
 * does not have, or a key that belongs to this device. Saved here, because this
 * tab is the first to get it.
 */
export function adoptAccountPrefs(blob: Record<string, unknown>) {
  adoptPrefs(blob, ACCOUNT_PREF_KEYS as PrefKey[]);
}

/** Each of `keys` that `blob` contains, read by its parser, then saved. */
function adoptPrefs(blob: Record<string, unknown>, keys: readonly PrefKey[]) {
  applyingRemotePrefs = true;
  try {
    batch(() => {
      for (const key of keys) {
        if (!(key in blob)) continue;
        prefSignal(key).value = PREF_PARSERS[key](blob[key], blob);
      }
    });
  } finally {
    applyingRemotePrefs = false;
  }
  savePrefs();
}

// The defaults of the server, on a browser that had no preferences of its own
// when it loaded, with nobody signed in. Each key, also the keys of the device,
// at the same time. Thus, the sign-in screen of a first visit already looks as
// the host selected. One time. When signed in, the copy of the account decides
// (`prefsSync.ts`).
let defaultsApplied = false;
effect(() => {
  const defaults = serverDefaultPrefs.value;
  if (!defaults || defaults.signedIn || !freshDevice || defaultsApplied) {
    return;
  }
  defaultsApplied = true;
  untracked(() => adoptPrefs(defaults.prefs, PREF_KEYS));
});

// Persist preferences when a pref signal changes (debounced).
let saveTimeout: ReturnType<typeof setTimeout> | undefined;
effect(() => {
  // Read each signal unconditionally. The reads subscribe this.
  for (const key of PREF_KEYS) prefSignal(key).value;
  if (applyingRemotePrefs) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(savePrefs, 50);
});

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== PREFS_KEY) return;
    applyPrefs(parsePrefs(event.newValue ?? localStorage.getItem(PREFS_KEY)));
  });
}

// --- Note corners ---

// Exposed as a class on <html>, not given to each note surface as a prop. The
// note card, the create-note stack and the editor all read the same
// `--note-radius` from CSS.
effect(() => {
  document.documentElement.classList.toggle(
    "notes-rounded",
    noteCorners.value === "rounded",
  );
});

// --- Note tilt ---

// Also a class on <html>. Each card carries its own angle as `--note-tilt`,
// whatever the setting, and the stylesheet applies it only on a messy board.
effect(() => {
  document.documentElement.classList.toggle(
    "notes-messy",
    noteTilt.value === "messy",
  );
});

// --- Motion ---

effect(() => {
  document.documentElement.classList.toggle("no-motion", !animations.value);
});

// --- Board background ---

// Attributes on <html>, as the dark hue is. styles.css sets the color and
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
// board takes as they are (`.board-frame::before` in preferences.css). A change
// of either draws nothing again. "auto" keeps the own ink of the theme, black
// or white.
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

// The picture textures, as masks that the layer reads as it reads the gradient
// masks. Only their shape is important. Thus, they are drawn one time, at load.
for (const [name, image] of Object.entries(pictureTextures())) {
  document.documentElement.style.setProperty(
    `--board-texture-${name}-mask`,
    image,
  );
}

// --- Light and dark hue ---

// Published as an attribute on <html>, not a class. Thus, the stylesheet can
// set one `--dark-tint-*` pair from it. The dark neutral ramp comes from that
// pair. Thus, each `neutral` utility in the app gets the new tint at the same
// time.
effect(() => {
  document.documentElement.dataset.darkHue = darkHue.value;
});

// The equivalent for the light theme, set in the same way. `--light-tint-*`
// control the light neutral ramp, and the white on which the page is drawn.
effect(() => {
  document.documentElement.dataset.lightHue = lightHue.value;
});

// --- Theme ---

function applyTheme(mode: ThemeMode) {
  const isDark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
  paintBrowserBar(isDark);
}

// The bar of the browser (`<meta name="theme-color">`) keeps the brand color in
// the light theme. In the dark theme, a blue bar over a dark header is too
// bright. Thus, it takes the own background of the header, read from the live
// ramp, so that a dark hue also tints it. A canvas changes that `oklch()` into
// the hex that each browser accepts there.
const themeColorMeta = document.querySelector<HTMLMetaElement>(
  'meta[name="theme-color"]',
);
const brandThemeColor = themeColorMeta?.content ?? "";

function paintBrowserBar(isDark: boolean) {
  if (!themeColorMeta) return;
  themeColorMeta.content = isDark
    ? (toHex(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--color-neutral-900",
        ),
      ) ?? brandThemeColor)
    : brandThemeColor;
}

function toHex(color: string): string | null {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx || !color.trim()) return null;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

effect(() => {
  // Read, so that a change of dark hue also paints the bar again.
  void darkHue.value;
  applyTheme(theme.value);
});

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (theme.value === "system") applyTheme("system");
  });
