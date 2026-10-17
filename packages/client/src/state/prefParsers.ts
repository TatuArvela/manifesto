import { NoteColor, NoteFont } from "@manifesto/shared";
import { detectBrowserLocale } from "../i18n/detect.js";
import { isLocale, type Locale } from "../i18n/locales.js";
import {
  INK_COLORS,
  type InkColor,
  type PickedInkChoice,
} from "../utils/boardTextures.js";

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
/** A colour a tag can be given: any note colour but the plain one. */
export type TagColor = Exclude<NoteColor, NoteColor.Default>;
/**
 * A preset board colour, each with a light and a dark shade in styles.css:
 * the hues of the note colours, which the pattern colours share.
 */
export type BoardColor = InkColor;
/** White, gray and black boards, each a light and a dark shade too. */
export type BoardNeutral = "white" | "gray" | "black";
/**
 * The board's colour: the page's own, a neutral, a preset,
 * `boardCustomColor`, or a preset picked at random on each visit.
 */
export type BoardColorChoice =
  | "none"
  | BoardNeutral
  | BoardColor
  | "custom"
  | "random";
/** Drawn over the board's colour in CSS, in ink that follows the theme. */
export type BoardTexture =
  | "none"
  | "paper"
  | "dots"
  | "grid"
  | "lines"
  | "confetti"
  | "waves"
  | "stars"
  | "hearts"
  | "bubbles"
  | "stripes"
  | "sawtooth";
/**
 * What the textures are drawn in: the theme's own faint ink, white, black, a
 * colourful preset, `boardInkColor`, or a colourful preset picked at random on
 * each visit.
 */
export type BoardInk = "auto" | PickedInkChoice | "random";
/** A texture, or a different one picked at random on each visit. */
export type BoardTextureChoice = BoardTexture | "random";
/**
 * The colour the board fades to from its own, or "none" for a flat board.
 * "custom" is `boardGradientCustomColor`, a second picked colour, and
 * "random" a preset picked on each visit, like the first colour's.
 */
export type BoardGradientChoice =
  | "none"
  | BoardNeutral
  | BoardColor
  | "custom"
  | "random";
/** Which way the board's colour fades into the gradient's, as a CSS side or corner. */
export type BoardGradientDirection =
  | "top"
  | "top-right"
  | "right"
  | "bottom-right"
  | "bottom"
  | "bottom-left"
  | "left"
  | "top-left";
/** A direction, or one picked at random on each visit. */
export type BoardGradientDirectionChoice = BoardGradientDirection | "random";
/**
 * The dark theme's shade: a grey with a cast, a dimmed or black one, or a
 * tint in the hue of one of the board's preset colours.
 */
export type DarkHue =
  | "neutral"
  | "midnight"
  | "mauve"
  | "lavender"
  | "indigo"
  | "slate"
  | "steel"
  | "ocean"
  | "black"
  | BoardColor;
/** The light theme's shade: plain white, or a tint of a preset colour. */
export type LightHue = "white" | BoardColor;

/** In compass order from the top, which is how Settings lays them out. */
export const BOARD_GRADIENT_DIRECTIONS: readonly BoardGradientDirection[] = [
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
  "top-left",
];

export const BOARD_TEXTURES: readonly BoardTexture[] = [
  "none",
  "paper",
  "dots",
  "grid",
  "lines",
  "confetti",
  "waves",
  "stars",
  "hearts",
  "bubbles",
  "stripes",
  "sawtooth",
];

/**
 * The preset colours, the same eight for the board and its pattern, each
 * drawn in a shade that suits where it is used.
 */
export const BOARD_COLORS = Object.keys(INK_COLORS) as BoardColor[];

/** Light to dark, which is how Settings lays them out. */
export const BOARD_NEUTRALS: readonly BoardNeutral[] = [
  "white",
  "gray",
  "black",
];

/**
 * The muted presets the board had before, each read as the preset nearest
 * it, so a board kept in one stays coloured.
 */
const RETIRED_BOARD_COLORS: Record<string, BoardColor> = {
  sand: "orange",
  caramel: "orange",
  sage: "green",
  mist: "blue",
  blush: "pink",
  lavender: "purple",
};

function parsePresetColor(value: unknown): BoardNeutral | BoardColor | "none" {
  if (typeof value !== "string") return "none";
  if ((BOARD_COLORS as readonly string[]).includes(value)) {
    return value as BoardColor;
  }
  if ((BOARD_NEUTRALS as readonly string[]).includes(value)) {
    return value as BoardNeutral;
  }
  return RETIRED_BOARD_COLORS[value] ?? "none";
}

export const BOARD_INKS: readonly BoardInk[] = [
  "auto",
  "white",
  "black",
  ...BOARD_COLORS,
  "custom",
  "random",
];

/** What the custom colour starts as before one is picked: a warm corkboard. */
export const DEFAULT_BOARD_CUSTOM_COLOR = "#d9bf94";
/** The pattern colour's start, until one is picked: a soft rose. */
export const DEFAULT_BOARD_INK_COLOR = "#e0607a";
/** The second custom colour's start: a dusk blue to fade the corkboard into. */
export const DEFAULT_BOARD_GRADIENT_CUSTOM_COLOR = "#9fb7d4";

function parseBoardColor(value: unknown): BoardColorChoice {
  if (value === "custom" || value === "random") return value;
  return parsePresetColor(value);
}

function parseBoardGradient(value: unknown): BoardGradientChoice {
  if (value === "custom" || value === "random") return value;
  return parsePresetColor(value);
}

/** Textures the board had before, each read as the nearest one left. */
const RETIRED_BOARD_TEXTURES: Record<string, BoardTexture> = {
  cork: "paper",
  felt: "paper",
  linen: "paper",
};

function parseBoardTexture(value: unknown): BoardTextureChoice {
  if (value === "random") return "random";
  if (typeof value === "string" && value in RETIRED_BOARD_TEXTURES) {
    return RETIRED_BOARD_TEXTURES[value] ?? "none";
  }
  return typeof value === "string" &&
    (BOARD_TEXTURES as readonly string[]).includes(value)
    ? (value as BoardTexture)
    : "none";
}

export function pickOne<T>(list: readonly T[]): T {
  const picked = list[Math.floor(Math.random() * list.length)];
  if (picked === undefined) throw new Error("Nothing to pick from");
  return picked;
}

/** What "random" stands for, which is anything but plain. */
export function rollBoardTexture(): BoardTexture {
  return pickOne(BOARD_TEXTURES.filter((texture) => texture !== "none"));
}

/**
 * A coloured preset: the page's own colour is no colour, a neutral hardly
 * one, and a custom one is chosen.
 */
export function rollBoardColor(except?: string | undefined): BoardColor {
  return pickOne(BOARD_COLORS.filter((color) => color !== except));
}

/**
 * Only a six-digit hex colour, which is all `<input type="color">` produces.
 * The value is written into a CSS custom property, so anything freer would be
 * a way to inject arbitrary CSS through a hand-edited preferences blob.
 */
function hexColor(fallback: string) {
  return (value: unknown): string =>
    typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
      ? value.toLowerCase()
      : fallback;
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
  "lavender",
  "indigo",
  "slate",
  "steel",
  "ocean",
  "black",
  ...BOARD_COLORS,
];

/** White, then the preset colours in the board's order. */
export const LIGHT_HUES: readonly LightHue[] = ["white", ...BOARD_COLORS];

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

/**
 * How many tags can hold a colour. The account's whole copy has to stay
 * within 16 KB, and this map is the one preference that grows with use.
 */
export const MAX_TAG_COLORS = 200;

/** Tag to colour, dropping whatever a hand-edited blob holds besides. */
function parseTagColors(value: unknown): Record<string, TagColor> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const colors = Object.values(NoteColor) as string[];
  const parsed: Record<string, TagColor> = {};
  for (const [tag, color] of Object.entries(value).slice(0, MAX_TAG_COLORS)) {
    if (typeof color !== "string" || color === NoteColor.Default) continue;
    if (colors.includes(color)) parsed[tag] = color as TagColor;
  }
  return parsed;
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
  lightHue: oneOf(LIGHT_HUES, "white"),
  // Lavender was called violet until purple joined the list beside it.
  darkHue: (value: unknown) =>
    oneOf(DARK_HUES, "neutral")(value === "violet" ? "lavender" : value),
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
  /**
   * The colour each tag is drawn with, for this user: the tags themselves
   * are on the notes, and someone a note is shared with has their own.
   */
  tagColors: parseTagColors,
  confirmBeforeDelete: flag(false),
  defaultEditMode: oneOf<EditMode>(["normal", "raw"], "normal"),
  boardColor: parseBoardColor,
  boardCustomColor: hexColor(DEFAULT_BOARD_CUSTOM_COLOR),
  boardGradient: parseBoardGradient,
  boardGradientCustomColor: hexColor(DEFAULT_BOARD_GRADIENT_CUSTOM_COLOR),
  boardGradientDirection: oneOf<BoardGradientDirectionChoice>(
    [...BOARD_GRADIENT_DIRECTIONS, "random"],
    "bottom-right",
  ),
  boardTexture: parseBoardTexture,
  boardInk: oneOf(BOARD_INKS, "auto"),
  boardInkColor: hexColor(DEFAULT_BOARD_INK_COLOR),
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
