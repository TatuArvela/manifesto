import { NoteColor, NoteFont } from "@manifesto/shared";
import { batch, computed, effect, signal } from "@preact/signals";
import { detectBrowserLocale } from "../i18n/detect.js";
import { isLocale, type Locale } from "../i18n/locales.js";

// --- Types ---

export type ViewMode = "grid" | "list";
export type NoteSize = "fit" | "square";
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
/** The board's colour: the page's own, a preset, or `boardCustomColor`. */
export type BoardColorChoice = "none" | BoardColor | "custom";
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
  if (value === "custom") return "custom";
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

function parseDarkHue(value: unknown): DarkHue {
  return typeof value === "string" &&
    (DARK_HUES as readonly string[]).includes(value)
    ? (value as DarkHue)
    : "neutral";
}

const NOTE_COLORS = new Set<string>(Object.values(NoteColor));

/**
 * The value indexes `noteColorMap` when a note is created, so anything
 * unrecognised falls back rather than reaching a card as `undefined`. Before
 * a specific colour could be the default, the setting was `"plain" | "random"`,
 * and `"plain"` meant what `NoteColor.Default` means now.
 */
function parseDefaultNoteColor(value: unknown): DefaultNoteColor {
  if (value === "random") return "random";
  return typeof value === "string" && NOTE_COLORS.has(value)
    ? (value as NoteColor)
    : NoteColor.Default;
}

function parseDecimalSeparator(value: unknown): DecimalSeparator {
  return typeof value === "string" &&
    (DECIMAL_SEPARATOR_VALUES as readonly string[]).includes(value)
    ? (value as DecimalSeparator)
    : "auto";
}

// --- Persisted preferences ---

const PREFS_KEY = "manifesto:prefs";

export interface LoadedPrefs {
  viewMode: ViewMode;
  sortMode: SortMode;
  noteSize: NoteSize;
  theme: ThemeMode;
  defaultNoteColor: DefaultNoteColor;
  defaultNoteFont: DefaultNoteFont;
  locale: Locale;
  inlineCalculations: boolean;
  decimalSeparator: DecimalSeparator;
  noteCorners: NoteCorners;
  animations: boolean;
  darkHue: DarkHue;
  noteQuips: boolean;
  formattingToolbar: boolean;
  confirmBeforeDelete: boolean;
  defaultEditMode: EditMode;
  boardColor: BoardColorChoice;
  boardCustomColor: string;
  boardTexture: BoardTextureChoice;
  /**
   * Whether the picture on file covers the board, in place of the colour and
   * texture. Those are kept, so turning the picture off brings them back.
   */
  boardUsePicture: boolean;
  /**
   * When the board picture was last replaced, or 0 with none on file. The
   * picture is in IndexedDB, which no other tab hears about, so this is what
   * changes in the preferences blob and tells them to load it again.
   */
  boardImageStamp: number;
}

export function parsePrefs(raw: string | null): LoadedPrefs {
  let persistedLocale: Locale | undefined;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isLocale(parsed.locale)) persistedLocale = parsed.locale;
      return {
        viewMode: parsed.viewMode ?? "grid",
        sortMode: parsed.sortMode ?? "default",
        noteSize: parsed.noteSize ?? "fit",
        theme: parsed.theme ?? "system",
        defaultNoteColor: parseDefaultNoteColor(parsed.defaultNoteColor),
        defaultNoteFont:
          parsed.defaultNoteFont ?? parsed.noteFont ?? NoteFont.Default,
        locale: persistedLocale ?? detectBrowserLocale(),
        inlineCalculations:
          typeof parsed.inlineCalculations === "boolean"
            ? parsed.inlineCalculations
            : true,
        decimalSeparator: parseDecimalSeparator(parsed.decimalSeparator),
        noteCorners: parsed.noteCorners === "rounded" ? "rounded" : "straight",
        animations:
          typeof parsed.animations === "boolean"
            ? parsed.animations
            : !prefersReducedMotion(),
        darkHue: parseDarkHue(parsed.darkHue),
        noteQuips:
          typeof parsed.noteQuips === "boolean" ? parsed.noteQuips : true,
        formattingToolbar:
          typeof parsed.formattingToolbar === "boolean"
            ? parsed.formattingToolbar
            : true,
        confirmBeforeDelete: parsed.confirmBeforeDelete === true,
        defaultEditMode: parsed.defaultEditMode === "raw" ? "raw" : "normal",
        boardColor: parseBoardColor(parsed.boardColor),
        boardCustomColor: parseHexColor(parsed.boardCustomColor),
        boardTexture: parseBoardTexture(parsed.boardTexture),
        boardUsePicture: parsed.boardUsePicture === true,
        boardImageStamp:
          typeof parsed.boardImageStamp === "number" &&
          Number.isFinite(parsed.boardImageStamp)
            ? parsed.boardImageStamp
            : 0,
      };
    } catch {
      // ignore
    }
  }
  return {
    viewMode: "grid",
    sortMode: "default",
    noteSize: "fit",
    theme: "system",
    defaultNoteColor: NoteColor.Default,
    defaultNoteFont: NoteFont.Default,
    locale: detectBrowserLocale(),
    inlineCalculations: true,
    decimalSeparator: "auto",
    noteCorners: "straight",
    animations: !prefersReducedMotion(),
    darkHue: "neutral",
    noteQuips: true,
    formattingToolbar: true,
    confirmBeforeDelete: false,
    defaultEditMode: "normal",
    boardColor: "none",
    boardCustomColor: DEFAULT_BOARD_CUSTOM_COLOR,
    boardTexture: "none",
    boardUsePicture: false,
    boardImageStamp: 0,
  };
}

function loadPrefs(): LoadedPrefs {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return parsePrefs(null);
  }
}

function savePrefs() {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      viewMode: viewMode.value,
      sortMode: sortMode.value,
      noteSize: noteSize.value,
      theme: theme.value,
      defaultNoteColor: defaultNoteColor.value,
      defaultNoteFont: defaultNoteFont.value,
      locale: locale.value,
      inlineCalculations: inlineCalculations.value,
      decimalSeparator: decimalSeparator.value,
      noteCorners: noteCorners.value,
      animations: animations.value,
      darkHue: darkHue.value,
      noteQuips: noteQuips.value,
      formattingToolbar: formattingToolbar.value,
      confirmBeforeDelete: confirmBeforeDelete.value,
      defaultEditMode: defaultEditMode.value,
      boardColor: boardColor.value,
      boardCustomColor: boardCustomColor.value,
      boardTexture: boardTexture.value,
      boardUsePicture: boardUsePicture.value,
      boardImageStamp: boardImageStamp.value,
    }),
  );
}

const prefs = loadPrefs();

export const viewMode = signal<ViewMode>(prefs.viewMode);
export const noteSize = signal<NoteSize>(prefs.noteSize);
export const sortMode = signal<SortMode>(prefs.sortMode);
export const theme = signal<ThemeMode>(prefs.theme);
export const defaultNoteColor = signal<DefaultNoteColor>(
  prefs.defaultNoteColor,
);
export const defaultNoteFont = signal<DefaultNoteFont>(prefs.defaultNoteFont);
export const locale = signal<Locale>(prefs.locale);
export const inlineCalculations = signal<boolean>(prefs.inlineCalculations);
export const decimalSeparator = signal<DecimalSeparator>(
  prefs.decimalSeparator,
);
export const noteCorners = signal<NoteCorners>(prefs.noteCorners);
export const animations = signal<boolean>(prefs.animations);
export const darkHue = signal<DarkHue>(prefs.darkHue);
export const noteQuips = signal<boolean>(prefs.noteQuips);
export const formattingToolbar = signal<boolean>(prefs.formattingToolbar);
export const confirmBeforeDelete = signal<boolean>(prefs.confirmBeforeDelete);
export const defaultEditMode = signal<EditMode>(prefs.defaultEditMode);
export const boardColor = signal<BoardColorChoice>(prefs.boardColor);
export const boardCustomColor = signal<string>(prefs.boardCustomColor);
export const boardTexture = signal<BoardTextureChoice>(prefs.boardTexture);
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
export const boardUsePicture = signal<boolean>(prefs.boardUsePicture);
export const boardImageStamp = signal<number>(prefs.boardImageStamp);

/** Returns the concrete decimal separator, resolving "auto" via current locale. */
export function resolvedDecimalSeparator(): "." | "," {
  if (decimalSeparator.value !== "auto") return decimalSeparator.value;
  return locale.value === "fi" ? "," : ".";
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
export function applyPrefs(loaded: LoadedPrefs) {
  applyingRemotePrefs = true;
  try {
    batch(() => {
      viewMode.value = loaded.viewMode;
      sortMode.value = loaded.sortMode;
      noteSize.value = loaded.noteSize;
      theme.value = loaded.theme;
      defaultNoteColor.value = loaded.defaultNoteColor;
      defaultNoteFont.value = loaded.defaultNoteFont;
      locale.value = loaded.locale;
      inlineCalculations.value = loaded.inlineCalculations;
      decimalSeparator.value = loaded.decimalSeparator;
      noteCorners.value = loaded.noteCorners;
      animations.value = loaded.animations;
      darkHue.value = loaded.darkHue;
      noteQuips.value = loaded.noteQuips;
      formattingToolbar.value = loaded.formattingToolbar;
      confirmBeforeDelete.value = loaded.confirmBeforeDelete;
      defaultEditMode.value = loaded.defaultEditMode;
      boardColor.value = loaded.boardColor;
      boardCustomColor.value = loaded.boardCustomColor;
      boardTexture.value = loaded.boardTexture;
      boardUsePicture.value = loaded.boardUsePicture;
      boardImageStamp.value = loaded.boardImageStamp;
    });
  } finally {
    applyingRemotePrefs = false;
  }
}

// Persist preferences when any pref signal changes (debounced)
let saveTimeout: ReturnType<typeof setTimeout> | undefined;
effect(() => {
  // Read all signals to establish dependencies
  viewMode.value;
  sortMode.value;
  noteSize.value;
  theme.value;
  defaultNoteColor.value;
  defaultNoteFont.value;
  locale.value;
  inlineCalculations.value;
  decimalSeparator.value;
  noteCorners.value;
  animations.value;
  darkHue.value;
  noteQuips.value;
  formattingToolbar.value;
  confirmBeforeDelete.value;
  defaultEditMode.value;
  boardColor.value;
  boardCustomColor.value;
  boardTexture.value;
  boardUsePicture.value;
  boardImageStamp.value;
  // The reads above stay unconditional: they are what subscribes this effect.
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
  const color = boardColor.value;
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
