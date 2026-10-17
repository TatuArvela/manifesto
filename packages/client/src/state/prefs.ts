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

/** Whether this browser had no preferences of its own when the page loaded. */
const freshDevice = (() => {
  try {
    return localStorage.getItem(PREFS_KEY) === null;
  } catch {
    return false;
  }
})();

const loaded = loadPrefs();
const prefSignals: Partial<Record<PrefKey, Signal<unknown>>> = {};

/** The signal for one preference, registered for saving and adopting. */
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
export const animations = pref("animations");
export const lightHue = pref("lightHue");
export const darkHue = pref("darkHue");
export const noteQuips = pref("noteQuips");
export const formattingToolbar = pref("formattingToolbar");
export const checkedItemsLast = pref("checkedItemsLast");
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

/** Never throws: storage that refuses (a private window, a full quota)
 * leaves the signals holding the preferences for this session. */
function savePrefs() {
  const blob: Record<string, unknown> = {};
  for (const key of PREF_KEYS) blob[key] = prefSignal(key).value;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(blob));
  } catch {
    // Kept in memory only.
  }
}

/** The preset "random" stands for in this tab; see `randomBoardTexture`. */
const randomBoardColor = signal<BoardColor>(rollBoardColor());

/** The colour choice actually on the board, with "random" resolved. */
export const resolvedBoardColor = computed<Exclude<BoardColorChoice, "random">>(
  () =>
    boardColor.value === "random" ? randomBoardColor.value : boardColor.value,
);

/** Picks another random colour, never the one showing now. */
export function rerollBoardColor() {
  const current = randomBoardColor.peek();
  let next = rollBoardColor();
  while (next === current) next = rollBoardColor();
  randomBoardColor.value = next;
}
/**
 * The texture "random" stands for in this tab. Rolled once per page load,
 * so the board changes between visits but never under the user mid-session,
 * and again by `rerollBoardTexture`. Not persisted: a fresh roll is the point.
 */
const randomBoardTexture = signal<BoardTexture>(rollBoardTexture());

/** The texture actually on the board, with "random" resolved. */
export const resolvedBoardTexture = computed<BoardTexture>(() =>
  boardTexture.value === "random"
    ? randomBoardTexture.value
    : boardTexture.value,
);

/** Picks another random texture, never the one showing now. */
export function rerollBoardTexture() {
  const current = randomBoardTexture.peek();
  let next = rollBoardTexture();
  while (next === current) next = rollBoardTexture();
  randomBoardTexture.value = next;
}

/** A preset for the gradient's "random", never the board's own colour. */
function rollBoardGradient(except: string | undefined): BoardColor {
  const color = resolvedBoardColor.peek();
  const first = color === "none" || color === "custom" ? undefined : color;
  let next = rollBoardColor(first);
  while (next === except) next = rollBoardColor(first);
  return next;
}

/**
 * The preset the gradient's "random" stands for in this tab, rolled like
 * `randomBoardColor` and never the same as it, or the board would be flat.
 */
const randomBoardGradient = signal<BoardColor>(rollBoardGradient(undefined));

/** The colour the board actually fades to, with "random" resolved. */
export const resolvedBoardGradient = computed<
  Exclude<BoardGradientChoice, "random">
>(() =>
  boardGradient.value === "random"
    ? randomBoardGradient.value
    : boardGradient.value,
);

/** Picks another random gradient colour, never the one showing now. */
export function rerollBoardGradient() {
  randomBoardGradient.value = rollBoardGradient(randomBoardGradient.peek());
}

/** The colourful preset the pattern colour's "random" stands for in this tab. */
const randomBoardInk = signal<BoardColor>(pickOne(BOARD_COLORS));

/** The pattern colour actually drawn in, with "random" resolved. */
export const resolvedBoardInk = computed<Exclude<BoardInk, "random">>(() =>
  boardInk.value === "random" ? randomBoardInk.value : boardInk.value,
);

/** Picks another random pattern colour, never the one showing now. */
export function rerollBoardInk() {
  const current = randomBoardInk.peek();
  randomBoardInk.value = pickOne(
    BOARD_COLORS.filter((color) => color !== current),
  );
}

/** The direction "random" stands for in this tab. */
const randomBoardGradientDirection = signal<BoardGradientDirection>(
  pickOne(BOARD_GRADIENT_DIRECTIONS),
);

/** The direction the board actually fades in, with "random" resolved. */
export const resolvedBoardGradientDirection = computed<BoardGradientDirection>(
  () =>
    boardGradientDirection.value === "random"
      ? randomBoardGradientDirection.value
      : boardGradientDirection.value,
);

/** Picks another random direction, never the one showing now. */
export function rerollBoardGradientDirection() {
  const current = randomBoardGradientDirection.peek();
  randomBoardGradientDirection.value = pickOne(
    BOARD_GRADIENT_DIRECTIONS.filter((way) => way !== current),
  );
}

/** Returns the concrete decimal separator, resolving "auto" via current locale. */
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

/** The colour a new note gets, with "random" resolved. */
export function pickDefaultColor(): NoteColor {
  const choice = defaultNoteColor.value;
  return choice === "random" ? pickOne(RANDOM_NOTE_COLORS) : choice;
}

/** The font a new note gets, with "random" resolved. */
export function pickDefaultFont(): NoteFont {
  const choice = defaultNoteFont.value;
  return choice === "random" ? pickOne(RANDOM_NOTE_FONTS) : choice;
}

/**
 * True while another tab's preferences are being applied. Every pref is
 * written back as one blob, so a tab that adopts a remote change and then
 * saves would send the same content around again; worse, a tab that never
 * adopted it would overwrite the change with its own stale copy on the next
 * unrelated toggle: change the theme in one tab, switch view mode in
 * another, and the theme is back.
 */
let applyingRemotePrefs = false;

/**
 * Whether the account's preferences come from the server (`prefsSync.ts`,
 * while signed in). Every tab then hears each change on its own socket, so
 * another tab's blob is taken for the device's preferences alone. Taken
 * whole, it put back a value this tab had just changed: the other tab saves
 * whenever it adopts the server's copy, and an echo of an earlier change,
 * heard late there, carries the value from before.
 */
let accountPrefsFromServer = false;

export function setAccountPrefsFromServer(on: boolean): void {
  accountPrefsFromServer = on;
}

const DEVICE_PREF_KEYS = PREF_KEYS.filter(
  (key) => !ACCOUNT_PREF_KEYS.includes(key),
);

/** Adopts a preferences blob written by another tab. */
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

/** Whether the change being made now came from elsewhere: another tab, or
 * the account's preferences on the server. `prefsSync.ts` sends neither on. */
export function isApplyingRemotePrefs(): boolean {
  return applyingRemotePrefs;
}

/** Every preference as it stands here, for an open-mode export. */
export function prefsSnapshot(): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const key of PREF_KEYS) snapshot[key] = prefSignal(key).value;
  return snapshot;
}

/** The account's preferences as they stand here, for the server. */
export function accountPrefsSnapshot(): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const key of ACCOUNT_PREF_KEYS) {
    snapshot[key] = prefSignal(key as PrefKey).value;
  }
  return snapshot;
}

/**
 * Adopts the account's preferences from the server: each key present, and
 * read by its parser as a hand-edited blob would be, since another client
 * wrote it. A key the server lacks, or one that belongs to this device, is
 * left as it is. Saved here, since this tab is the first to hear of it.
 */
export function adoptAccountPrefs(blob: Record<string, unknown>) {
  adoptPrefs(blob, ACCOUNT_PREF_KEYS as PrefKey[]);
}

/** Each of `keys` that `blob` holds, read by its parser, then saved. */
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

// The server's defaults, on a browser that had no preferences of its own
// when it loaded and nobody signed in: every key, the device's own included,
// at once, so the sign-in screen of a first visit already looks as the host
// chose. Once. Signed in, the account's copy decides (`prefsSync.ts`).
let defaultsApplied = false;
effect(() => {
  const defaults = serverDefaultPrefs.value;
  if (!defaults || defaults.signedIn || !freshDevice || defaultsApplied) {
    return;
  }
  defaultsApplied = true;
  untracked(() => adoptPrefs(defaults.prefs, PREF_KEYS));
});

// Persist preferences when any pref signal changes (debounced)
let saveTimeout: ReturnType<typeof setTimeout> | undefined;
effect(() => {
  // Read every signal unconditionally: the reads are what subscribe this.
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

// Exposed as a class on <html> rather than threaded through every note
// surface as a prop: the note card, the create-note stack and the editor all
// read the same `--note-radius` from CSS.
effect(() => {
  document.documentElement.classList.toggle(
    "notes-rounded",
    noteCorners.value === "rounded",
  );
});

// --- Motion ---

effect(() => {
  document.documentElement.classList.toggle("no-motion", !animations.value);
});

// --- Board background ---

// Attributes on <html>, like the dark hue: styles.css keys the board's colour
// and texture off them, in both themes. A custom colour is handed over as
// `--board-custom`, which the dark theme deepens, and likewise the gradient's
// second custom colour. The picture, which covers both, is applied by
// state/board.ts.
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
  // The custom pattern colour's swatch in Settings shows it.
  root.style.setProperty("--board-ink-custom", boardInkColor.value);
  root.style.setProperty(
    "--board-gradient-custom",
    boardGradientCustomColor.value,
  );
});

// The pattern's colour and opacity, which the texture layer behind the board
// takes as they are (`.board-frame::before` in preferences.css): a change of
// either redraws nothing. "auto" leaves the theme's own ink, black or white.
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

// The picture textures, as masks the layer reads like the gradient ones. Only
// their shape counts, so they are drawn once, at load.
for (const [name, image] of Object.entries(pictureTextures())) {
  document.documentElement.style.setProperty(
    `--board-texture-${name}-mask`,
    image,
  );
}

// --- Light and dark hue ---

// Published as an attribute on <html> rather than a class so the stylesheet can
// key one `--dark-tint-*` pair off it; the dark neutral ramp is derived from
// that pair, so every `neutral` utility in the app re-tints at once.
effect(() => {
  document.documentElement.dataset.darkHue = darkHue.value;
});

// The light theme's counterpart, keyed the same way: `--light-tint-*` drive
// the light neutral ramp and the white the page is drawn on.
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

// The browser's bar (`<meta name="theme-color">`) keeps the brand colour in
// the light theme. In the dark one a blue bar over a dark header glares, so it
// takes the header's own background instead, read from the live ramp so a
// dark hue tints it too. A canvas turns that `oklch()` into the hex every
// browser accepts there.
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
  // Read so a change of dark hue repaints the bar as well.
  void darkHue.value;
  applyTheme(theme.value);
});

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (theme.value === "system") applyTheme("system");
  });
