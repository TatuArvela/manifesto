import { NoteColor, NoteFont } from "@manifesto/shared";
import { detectBrowserLocale } from "#/i18n/detect.ts";
import { isLocale, type Locale } from "#/i18n/locales.ts";
import {
  DEFAULT_TEXTURE_OPACITY,
  INK_COLORS,
  type InkColor,
  MAX_TEXTURE_OPACITY,
  MIN_TEXTURE_OPACITY,
  type PickedInkChoice,
} from "#/utils/boardTextures.ts";

// What each preference can contain, and how the code reads back a stored value:
// the types, the lists of choices, and `PREF_PARSERS`. That is the one table
// that the load, the save, the adoption of the blob of a different tab and the
// sync with the account all read. The signals built on it are in `prefs.ts`.

// --- Types ---

export type ViewMode = "grid" | "list";
export type NoteSize = "fit" | "square";
/** How wide the cards of the grid are: big puts fewer in a row, small more. */
export type NoteScale = "big" | "small";
export type SortMode = "default" | "updated" | "created";
export type ThemeMode = "system" | "light" | "dark";
export type DefaultNoteColor = NoteColor | "random";
export type DefaultNoteFont = NoteFont | "random";
export type DecimalSeparator = "auto" | "." | ",";
export type NoteCorners = "straight" | "rounded";
/** If the cards are level on the board, or each one tilts a little. */
export type NoteTilt = "tidy" | "messy";
export type EditMode = "normal" | "raw";
/** A color that a tag can get: any note color other than the plain one. */
export type TagColor = Exclude<NoteColor, NoteColor.Default>;
/**
 * A preset board color, each with a light and a dark shade in styles.css: the
 * hues of the note colors, which the pattern colors share.
 */
export type BoardColor = InkColor;
/** White, gray and black boards, each also with a light and a dark shade. */
export type BoardNeutral = "white" | "gray" | "black";
/**
 * The color of the board: the own color of the page, a neutral, a preset,
 * `boardCustomColor`, or a preset selected at random on each visit.
 */
export type BoardColorChoice =
  | "none"
  | BoardNeutral
  | BoardColor
  | "custom"
  | "random";
/** Drawn over the color of the board in CSS, in ink that follows the theme. */
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
 * The color of the textures: the faint ink of the theme, white, black, a
 * colorful preset, `boardInkColor`, or a colorful preset selected at random on
 * each visit.
 */
export type BoardInk = "auto" | PickedInkChoice | "random";
/** A texture, or a different texture selected at random on each visit. */
export type BoardTextureChoice = BoardTexture | "random";
/**
 * The color to which the board fades from its own, or "none" for a flat board.
 * "custom" is `boardGradientCustomColor`, a second selected color. "random" is
 * a preset selected on each visit, as for the first color.
 */
export type BoardGradientChoice =
  | "none"
  | BoardNeutral
  | BoardColor
  | "custom"
  | "random";
/**
 * The direction in which the color of the board fades into that of the
 * gradient, as a CSS side or corner.
 */
export type BoardGradientDirection =
  | "top"
  | "top-right"
  | "right"
  | "bottom-right"
  | "bottom"
  | "bottom-left"
  | "left"
  | "top-left";
/** A direction, or a direction selected at random on each visit. */
export type BoardGradientDirectionChoice = BoardGradientDirection | "random";
/**
 * The shade of the dark theme: a gray with a hue, a dimmed or black shade, or a
 * tint in the hue of one of the preset colors of the board.
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
/** The shade of the light theme: plain white, or a tint of a preset color. */
export type LightHue = "white" | BoardColor;

/** In compass order from the top, which is the layout in Settings. */
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
  "waves",
  "confetti",
  "stars",
  "hearts",
  "bubbles",
  "stripes",
  "sawtooth",
];

/**
 * The preset colors, the same eight for the board and its pattern, each drawn
 * in a shade that is correct for where it is used.
 */
export const BOARD_COLORS = Object.keys(INK_COLORS) as BoardColor[];

/** Light to dark, which is the layout in Settings. */
export const BOARD_NEUTRALS: readonly BoardNeutral[] = [
  "white",
  "gray",
  "black",
];

/**
 * The muted presets that the board had before, each read as the nearest preset.
 * Thus, a board kept in one keeps a color.
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
  return Object.hasOwn(RETIRED_BOARD_COLORS, value)
    ? (RETIRED_BOARD_COLORS[value] ?? "none")
    : "none";
}

export const BOARD_INKS: readonly BoardInk[] = [
  "auto",
  "white",
  "black",
  ...BOARD_COLORS,
  "custom",
  "random",
];

/**
 * The start value of the custom color before the user selects one: a warm
 * corkboard.
 */
export const DEFAULT_BOARD_CUSTOM_COLOR = "#d9bf94";
/**
 * The start value of the pattern color, until the user selects one: a soft
 * rose.
 */
export const DEFAULT_BOARD_INK_COLOR = "#e0607a";
/**
 * The start value of the second custom color: a dusk blue into which the
 * corkboard fades.
 */
export const DEFAULT_BOARD_GRADIENT_CUSTOM_COLOR = "#9fb7d4";

function parseBoardColor(value: unknown): BoardColorChoice {
  if (value === "custom" || value === "random") return value;
  return parsePresetColor(value);
}

function parseBoardGradient(value: unknown): BoardGradientChoice {
  if (value === "custom" || value === "random") return value;
  return parsePresetColor(value);
}

/**
 * Textures that the board had before, each read as the nearest texture that
 * remains.
 */
const RETIRED_BOARD_TEXTURES: Record<string, BoardTexture> = {
  cork: "paper",
  felt: "paper",
  linen: "paper",
};

function parseBoardTexture(value: unknown): BoardTextureChoice {
  if (value === "random") return "random";
  if (
    typeof value === "string" &&
    Object.hasOwn(RETIRED_BOARD_TEXTURES, value)
  ) {
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

/** What "random" means, which is any texture other than plain. */
export function rollBoardTexture(): BoardTexture {
  return pickOne(BOARD_TEXTURES.filter((texture) => texture !== "none"));
}

/**
 * A colored preset. The own color of the page is no color, a neutral is almost
 * none, and a custom color is selected.
 */
export function rollBoardColor(except?: string | undefined): BoardColor {
  return pickOne(BOARD_COLORS.filter((color) => color !== except));
}

/**
 * Only a six-digit hex color, which is all that `<input type="color">` makes.
 * The value is written into a CSS custom property. Thus, a less strict value
 * would be a way to inject any CSS through a manually edited preferences blob.
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

// Neutral and the near-black next to it, then the tints from warm to cool along
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

/** White, then the preset colors in the order of the board. */
export const LIGHT_HUES: readonly LightHue[] = ["white", ...BOARD_COLORS];

/**
 * The default of the animations preference on the first run: follow the
 * accessibility setting of the OS. After the user changes the toggle, their
 * choice is persisted and wins. Thus, a later change in the OS does not
 * override it.
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
 * The value is an index into `noteColorMap` when a note is created. Thus, an
 * unknown value falls back, and does not reach a card as `undefined`. The
 * setting was `"plain" | "random"` before, and `"plain"` falls back to what it
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

/**
 * Only strings, each one time. The code drops all other values in a manually
 * edited blob.
 */
function parseTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((tag): tag is string => typeof tag === "string")),
  ];
}

/**
 * How many tags can have a color. The full copy of the account must stay within
 * 16 KB, and this map is the one preference that grows with use.
 */
export const MAX_TAG_COLORS = 200;

/**
 * Tag to color. The code drops all other data that a manually edited blob
 * contains.
 */
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
 * Each preference, as the parser that reads it from the stored blob. A missing
 * or unknown value parses to the default. Thus, the defaults are
 * `parse(undefined)`. A new preference is one line here and one `pref()` in
 * `prefs.ts`. The load, the save and the adoption of the blob of a different
 * tab all read this table.
 */
export const PREF_PARSERS = {
  viewMode: oneOf<ViewMode>(["grid", "list"], "grid"),
  sortMode: oneOf<SortMode>(["default", "updated", "created"], "default"),
  noteSize: oneOf<NoteSize>(["fit", "square"], "fit"),
  noteScale: oneOf<NoteScale>(["big", "small"], "big"),
  theme: oneOf<ThemeMode>(["system", "light", "dark"], "system"),
  defaultNoteColor: parseDefaultNoteColor,
  // `noteFont` is the old name of the key.
  defaultNoteFont: (value: unknown, blob: Record<string, unknown>) =>
    parseDefaultNoteFont(value ?? blob.noteFont),
  locale: (value: unknown): Locale =>
    isLocale(value) ? value : detectBrowserLocale(),
  inlineCalculations: flag(true),
  decimalSeparator: oneOf(DECIMAL_SEPARATOR_VALUES, "auto"),
  noteCorners: oneOf<NoteCorners>(["straight", "rounded"], "straight"),
  noteTilt: oneOf<NoteTilt>(["tidy", "messy"], "tidy"),
  // The curled shadow of a sheet of paper under each card. Off, a card has a
  // plain, even shadow.
  complexShadows: flag(true),
  // The default on the first run follows the OS setting. After the user changes
  // the toggle, their choice wins.
  animations: (value: unknown): boolean =>
    typeof value === "boolean" ? value : !prefersReducedMotion(),
  lightHue: oneOf(LIGHT_HUES, "white"),
  // Lavender had the name violet until purple joined the list next to it.
  darkHue: (value: unknown) =>
    oneOf(DARK_HUES, "neutral")(value === "violet" ? "lavender" : value),
  noteQuips: flag(true),
  formattingToolbar: flag(true),
  /**
   * If a tick of a checklist item moves it below the items that are still to
   * do.
   */
  checkedItemsLast: flag(false),
  /** If a card with a checklist shows how much of it is ticked. */
  checklistProgress: flag(true),
  /** If a link pasted or inserted into a note gets a preview card. */
  linkPreviewCards: flag(true),
  /**
   * In the app installed on a phone, if a link opens in the browser of the
   * system, not in the own view of the app (`state/externalLinks.ts`).
   */
  openLinksInBrowser: flag(false),
  /**
   * On a phone, if the top bar stays at the top of the screen while the board
   * scrolls, or scrolls away with it. Wider screens always keep it.
   */
  stickyTopBar: flag(true),
  /**
   * Tags whose notes stay out of the Notes view. They are still in Tags,
   * Search, Reminders and the other views. This only keeps the main board
   * clear.
   */
  hiddenTags: parseTagList,
  /**
   * The color with which each tag is drawn, for this user. The tags themselves
   * are on the notes, and a person with whom a note is shared has their own.
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
  /** The opacity of the pattern, in whole percent, whatever its color. */
  boardTextureOpacity: (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(
          MAX_TEXTURE_OPACITY,
          Math.max(MIN_TEXTURE_OPACITY, Math.round(value)),
        )
      : DEFAULT_TEXTURE_OPACITY,
  /**
   * If the stored picture covers the board, in place of the color and texture.
   * Those are kept. Thus, when the picture is turned off, they come back.
   */
  boardUsePicture: flag(false),
  /**
   * When the board picture was last replaced, or 0 when none is stored. The
   * picture is in IndexedDB, which tells no other tab. Thus, this value changes
   * in the preferences blob, and tells them to load it again.
   */
  boardImageStamp: (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0,
} satisfies Record<
  string,
  (value: unknown, blob: Record<string, unknown>) => unknown
>;

export type PrefKey = keyof typeof PREF_PARSERS;

/**
 * The preferences that belong to this device, not to the account, and thus
 * never go to the server. The top bar of the phone, the card size and the
 * motion suit this screen and its OS setting, and the board picture is in this
 * browser.
 */
const DEVICE_PREFS: ReadonlySet<PrefKey> = new Set<PrefKey>([
  "stickyTopBar",
  "noteScale",
  "animations",
  "boardUsePicture",
  "boardImageStamp",
  "openLinksInBrowser",
]);

export type LoadedPrefs = {
  [K in PrefKey]: ReturnType<(typeof PREF_PARSERS)[K]>;
};

export const PREF_KEYS = Object.keys(PREF_PARSERS) as PrefKey[];

/** Each preference that follows the account in connected mode. */
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
      // Unreadable: each preference takes its default.
    }
  }
  const loaded: Record<string, unknown> = {};
  for (const key of PREF_KEYS) {
    loaded[key] = PREF_PARSERS[key](blob[key], blob);
  }
  return loaded as LoadedPrefs;
}
