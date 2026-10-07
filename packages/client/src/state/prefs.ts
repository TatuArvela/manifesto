import { NoteColor, NoteFont } from "@manifesto/shared";
import { batch, computed, effect, type Signal, signal } from "@preact/signals";
import {
  ACCOUNT_PREF_KEYS,
  type BoardColor,
  type BoardColorChoice,
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
} from "./prefParsers.js";

export type {
  BoardColor,
  BoardColorChoice,
  BoardTexture,
  BoardTextureChoice,
  DarkHue,
  DecimalSeparator,
  DefaultNoteColor,
  DefaultNoteFont,
  EditMode,
  LoadedPrefs,
  NoteCorners,
  NoteScale,
  NoteSize,
  SortMode,
  TagColor,
  ThemeMode,
  ViewMode,
} from "./prefParsers.js";
export {
  ACCOUNT_PREF_KEYS,
  BOARD_COLORS,
  BOARD_TEXTURES,
  DARK_HUES,
  DEFAULT_BOARD_CUSTOM_COLOR,
  MAX_TAG_COLORS,
  parsePrefs,
} from "./prefParsers.js";

// --- Persisted preferences ---

const PREFS_KEY = "manifesto:prefs";

function loadPrefs(): LoadedPrefs {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return parsePrefs(null);
  }
}

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
export const darkHue = pref("darkHue");
export const noteQuips = pref("noteQuips");
export const formattingToolbar = pref("formattingToolbar");
export const stickyTopBar = pref("stickyTopBar");
export const hiddenTags = pref("hiddenTags");
export const tagColors = pref("tagColors");
export const confirmBeforeDelete = pref("confirmBeforeDelete");
export const defaultEditMode = pref("defaultEditMode");
export const boardColor = pref("boardColor");
export const boardCustomColor = pref("boardCustomColor");
export const boardTexture = pref("boardTexture");
export const boardUsePicture = pref("boardUsePicture");
export const boardImageStamp = pref("boardImageStamp");

for (const key of PREF_KEYS) {
  if (!prefSignals[key]) throw new Error(`Preference "${key}" has no signal`);
}

function prefSignal(key: PrefKey): Signal<unknown> {
  return prefSignals[key] as Signal<unknown>;
}

function savePrefs() {
  const blob: Record<string, unknown> = {};
  for (const key of PREF_KEYS) blob[key] = prefSignal(key).value;
  localStorage.setItem(PREFS_KEY, JSON.stringify(blob));
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

/** Adopts a preferences blob written by another tab. */
export function applyPrefs(next: LoadedPrefs) {
  applyingRemotePrefs = true;
  try {
    batch(() => {
      for (const key of PREF_KEYS) prefSignal(key).value = next[key];
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
  applyingRemotePrefs = true;
  try {
    batch(() => {
      for (const key of ACCOUNT_PREF_KEYS as PrefKey[]) {
        if (!(key in blob)) continue;
        prefSignal(key).value = PREF_PARSERS[key](blob[key], blob);
      }
    });
  } finally {
    applyingRemotePrefs = false;
  }
  try {
    savePrefs();
  } catch {
    // Storage refused: the signals hold them for this session.
  }
}

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
// `--board-custom`, which the dark theme deepens. The picture, which covers
// both, is applied by state/board.ts.
effect(() => {
  const root = document.documentElement;
  const color = resolvedBoardColor.value;
  const texture = resolvedBoardTexture.value;
  if (color === "none") delete root.dataset.boardColor;
  else root.dataset.boardColor = color;
  if (texture === "none") delete root.dataset.boardTexture;
  else root.dataset.boardTexture = texture;
  root.style.setProperty("--board-custom", boardCustomColor.value);
});

// --- Dark hue ---

// Published as an attribute on <html> rather than a class so the stylesheet can
// key one `--dark-tint-*` pair off it; the dark neutral ramp is derived from
// that pair, so every `neutral` utility in the app re-tints at once.
effect(() => {
  document.documentElement.dataset.darkHue = darkHue.value;
});

// --- Theme ---

function applyTheme(mode: ThemeMode) {
  const isDark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

effect(() => applyTheme(theme.value));

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (theme.value === "system") applyTheme("system");
  });
