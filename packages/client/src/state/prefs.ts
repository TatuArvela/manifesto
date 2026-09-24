import { NoteColor, NoteFont } from "@manifesto/shared";
import { batch, computed, effect, type Signal, signal } from "@preact/signals";
import { detectBrowserLocale } from "../i18n/detect.js";
import { isLocale, type Locale } from "../i18n/locales.js";

// --- Types ---

export type ViewMode = "grid" | "list";
export type NoteSize = "fit" | "square";
/** How wide the grid's cards are: big fits fewer to a row, small more. */
export type NoteScale = "big" | "small";
export type SortMode = "default" | "updated" | "created";
export type ThemeMode = "system" | "light" | "dark";
export type DefaultNoteColor = NoteColor | "random";
export type DefaultNoteFont = NoteFont | "random";
export type DecimalSeparator = "auto" | "." | ",";
export type NoteCorners = "straight" | "rounded";
export type EditMode = "normal" | "raw";
/** A preset board tint, each with a light and a dark shade in styles.css. */
export type BoardColor =
  | "sand"
  | "sage"
  | "mist"
  | "blush"
  | "lavender"
  | "caramel";
/**
 * The board's colour: the page's own, a preset, `boardCustomColor`, or a
 * preset picked at random on each visit.
 */
export type BoardColorChoice = "none" | BoardColor | "custom" | "random";
/** Drawn over the board's colour in CSS, in ink that follows the theme. */
export type BoardTexture =
  | "none"
  | "paper"
  | "cork"
  | "felt"
  | "linen"
  | "dots"
  | "grid"
  | "lines"
  | "confetti"
  | "waves"
  | "stars"
  | "hearts";
/** A texture, or a different one picked at random on each visit. */
export type BoardTextureChoice = BoardTexture | "random";
export type DarkHue =
  | "neutral"
  | "midnight"
  | "mauve"
  | "violet"
  | "indigo"
  | "slate"
  | "steel"
  | "ocean"
  | "black";

export const BOARD_COLORS: readonly BoardColor[] = [
  "sand",
  "sage",
  "mist",
  "blush",
  "lavender",
  "caramel",
];

export const BOARD_TEXTURES: readonly BoardTexture[] = [
  "none",
  "paper",
  "cork",
  "felt",
  "linen",
  "dots",
  "grid",
  "lines",
  "confetti",
  "waves",
  "stars",
  "hearts",
];

/** What the custom colour starts as before one is picked: a warm corkboard. */
export const DEFAULT_BOARD_CUSTOM_COLOR = "#d9bf94";

function parseBoardColor(value: unknown): BoardColorChoice {
  if (value === "custom" || value === "random") return value;
  return typeof value === "string" &&
    (BOARD_COLORS as readonly string[]).includes(value)
    ? (value as BoardColor)
    : "none";
}

function parseBoardTexture(value: unknown): BoardTextureChoice {
  if (value === "random") return "random";
  return typeof value === "string" &&
    (BOARD_TEXTURES as readonly string[]).includes(value)
    ? (value as BoardTexture)
    : "none";
}

function pickOne<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** What "random" stands for, which is anything but plain. */
function rollBoardTexture(): BoardTexture {
  return pickOne(BOARD_TEXTURES.filter((texture) => texture !== "none"));
}

/** A preset: the page's own colour is no colour, and a custom one is chosen. */
function rollBoardColor(): BoardColor {
  return pickOne(BOARD_COLORS);
}

/**
 * Only a six-digit hex colour, which is all `<input type="color">` produces.
 * The value is written into a CSS custom property, so anything freer would be
 * a way to inject arbitrary CSS through a hand-edited preferences blob.
 */
function parseHexColor(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : DEFAULT_BOARD_CUSTOM_COLOR;
}

const DECIMAL_SEPARATOR_VALUES: readonly DecimalSeparator[] = [
  "auto",
  ".",
  ",",
];

// Neutral and the near-black beside it, then the tints warm to cool along
// the violet-blue arc, with true black at the far end.
export const DARK_HUES: readonly DarkHue[] = [
  "neutral",
  "midnight",
  "mauve",
  "violet",
  "indigo",
  "slate",
  "steel",
  "ocean",
  "black",
];

/**
 * First-run default for the animations preference: follow the OS accessibility
 * setting. Once the user flips the toggle their choice is persisted and wins,
 * so a later OS change does not override it.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const NOTE_COLORS = new Set<string>(Object.values(NoteColor));
const NOTE_FONTS = new Set<string>(Object.values(NoteFont));

/**
 * The value indexes `noteColorMap` when a note is created, so anything
 * unrecognised falls back rather than reaching a card as `undefined`. The
 * setting was once `"plain" | "random"`, and `"plain"` falls back to what it
 * meant, `NoteColor.Default`.
 */
function parseDefaultNoteColor(value: unknown): DefaultNoteColor {
  if (value === "random") return "random";
  return typeof value === "string" && NOTE_COLORS.has(value)
    ? (value as NoteColor)
    : NoteColor.Default;
}

function parseDefaultNoteFont(value: unknown): DefaultNoteFont {
  if (value === "random") return "random";
  return typeof value === "string" && NOTE_FONTS.has(value)
    ? (value as NoteFont)
    : NoteFont.Default;
}

/** Strings only, each once: anything else in a hand-edited blob is dropped. */
function parseTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((tag): tag is string => typeof tag === "string")),
  ];
}

function oneOf<T extends string>(values: readonly T[], fallback: T) {
  return (value: unknown): T =>
    typeof value === "string" && (values as readonly string[]).includes(value)
      ? (value as T)
      : fallback;
}

function flag(fallback: boolean) {
  return (value: unknown): boolean =>
    typeof value === "boolean" ? value : fallback;
}

// --- Persisted preferences ---

const PREFS_KEY = "manifesto:prefs";

/**
 * Every preference, as the parser that reads it from the stored blob. A
 * missing or unrecognised value parses to the default, so the defaults are
 * `parse(undefined)`. Adding a preference is one line here and one `pref()`
 * below; loading, saving and adopting another tab's blob all read this table.
 */
const PREF_PARSERS = {
  viewMode: oneOf<ViewMode>(["grid", "list"], "grid"),
  sortMode: oneOf<SortMode>(["default", "updated", "created"], "default"),
  noteSize: oneOf<NoteSize>(["fit", "square"], "fit"),
  noteScale: oneOf<NoteScale>(["big", "small"], "big"),
  theme: oneOf<ThemeMode>(["system", "light", "dark"], "system"),
  defaultNoteColor: parseDefaultNoteColor,
  // `noteFont` is the key's old name.
  defaultNoteFont: (value: unknown, blob: Record<string, unknown>) =>
    parseDefaultNoteFont(value ?? blob.noteFont),
  locale: (value: unknown): Locale =>
    isLocale(value) ? value : detectBrowserLocale(),
  inlineCalculations: flag(true),
  decimalSeparator: oneOf(DECIMAL_SEPARATOR_VALUES, "auto"),
  noteCorners: oneOf<NoteCorners>(["straight", "rounded"], "straight"),
  // First-run default follows the OS setting; once the user flips the
  // toggle, their choice wins.
  animations: (value: unknown): boolean =>
    typeof value === "boolean" ? value : !prefersReducedMotion(),
  darkHue: oneOf(DARK_HUES, "neutral"),
  noteQuips: flag(true),
  formattingToolbar: flag(true),
  /**
   * On a phone, whether the top bar stays at the top of the screen while the
   * board scrolls, or scrolls away with it. Wider screens always keep it.
   */
  stickyTopBar: flag(true),
  /**
   * Tags whose notes stay out of the Notes view. They are still in Tags,
   * Search, Reminders and the rest; this only keeps the main board clear.
   */
  hiddenTags: parseTagList,
  confirmBeforeDelete: flag(false),
  defaultEditMode: oneOf<EditMode>(["normal", "raw"], "normal"),
  boardColor: parseBoardColor,
  boardCustomColor: parseHexColor,
  boardTexture: parseBoardTexture,
  /**
   * Whether the picture on file covers the board, in place of the colour and
   * texture. Those are kept, so turning the picture off brings them back.
   */
  boardUsePicture: flag(false),
  /**
   * When the board picture was last replaced, or 0 with none on file. The
   * picture is in IndexedDB, which no other tab hears about, so this is what
   * changes in the preferences blob and tells them to load it again.
   */
  boardImageStamp: (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0,
} satisfies Record<
  string,
  (value: unknown, blob: Record<string, unknown>) => unknown
>;

type PrefKey = keyof typeof PREF_PARSERS;

export type LoadedPrefs = {
  [K in PrefKey]: ReturnType<(typeof PREF_PARSERS)[K]>;
};

const PREF_KEYS = Object.keys(PREF_PARSERS) as PrefKey[];

export function parsePrefs(raw: string | null): LoadedPrefs {
  let blob: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        blob = parsed as Record<string, unknown>;
      }
    } catch {
      // Unreadable: every preference takes its default.
    }
  }
  const loaded: Record<string, unknown> = {};
  for (const key of PREF_KEYS) {
    loaded[key] = PREF_PARSERS[key](blob[key], blob);
  }
  return loaded as LoadedPrefs;
}

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
