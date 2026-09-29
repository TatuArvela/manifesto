import { NoteColor, NoteFont } from "@manifesto/shared";
import { detectBrowserLocale } from "../i18n/detect.js";
import { isLocale, type Locale } from "../i18n/locales.js";

// What each preference may hold and how a stored value is read back: the
// types, the lists of choices, and `PREF_PARSERS`, the one table that loading,
// saving, adopting another tab's blob and syncing with the account all read.
// The signals built on it are in `prefs.ts`.

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

export function pickOne<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** What "random" stands for, which is anything but plain. */
export function rollBoardTexture(): BoardTexture {
  return pickOne(BOARD_TEXTURES.filter((texture) => texture !== "none"));
}

/** A preset: the page's own colour is no colour, and a custom one is chosen. */
export function rollBoardColor(): BoardColor {
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

/**
 * Every preference, as the parser that reads it from the stored blob. A
 * missing or unrecognised value parses to the default, so the defaults are
 * `parse(undefined)`. Adding a preference is one line here and one `pref()`
 * in `prefs.ts`; loading, saving and adopting another tab's blob all read this table.
 */
export const PREF_PARSERS = {
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

export type PrefKey = keyof typeof PREF_PARSERS;

/**
 * The preferences that belong to this device rather than the account, and so
 * never go to the server: the phone's top bar, card size and motion suit this
 * screen and its OS setting, and the board picture lives in this browser.
 */
const DEVICE_PREFS: ReadonlySet<PrefKey> = new Set<PrefKey>([
  "stickyTopBar",
  "noteScale",
  "animations",
  "boardUsePicture",
  "boardImageStamp",
]);

export type LoadedPrefs = {
  [K in PrefKey]: ReturnType<(typeof PREF_PARSERS)[K]>;
};

export const PREF_KEYS = Object.keys(PREF_PARSERS) as PrefKey[];

/** Every preference that follows the account in connected mode. */
export const ACCOUNT_PREF_KEYS: readonly string[] = PREF_KEYS.filter(
  (key) => !DEVICE_PREFS.has(key),
);

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
