import type { InkColor } from "./boardInk.ts";
import { hexToOklch, maxChroma } from "./oklch.ts";

// The shades of the light and dark themes, as data. Each shade is one `Tint`,
// and the stylesheets make the full neutral ramp of a theme from it
// (styles/light-shade.css, styles/dark-shade.css). Thus, a preset and a custom
// color are the same thing to the CSS: three custom properties. The presets
// are a table here, not rules in the stylesheet, so that the contrast test
// (`colors.test.ts`) reads the same values that the app applies.

/**
 * The tint of a neutral ramp: the chroma and hue at the surface end, and the
 * dim, in percent of lightness, that makes the surfaces darker than the ramp of
 * Tailwind.
 */
export interface Tint {
  chroma: number;
  hue: number;
  dim: number;
}

/** The colors that a shade can take, the same as the preset board colors. */
export type ShadeColor = InkColor;

/** The hue of each preset color, the same in both themes. */
export const SHADE_COLOR_HUES: Record<ShadeColor, number> = {
  red: 25,
  orange: 55,
  yellow: 100,
  green: 150,
  teal: 185,
  blue: 255,
  purple: 305,
  pink: 350,
};

const SHADE_COLORS = Object.keys(SHADE_COLOR_HUES) as ShadeColor[];

/** A more saturated light shade of a preset color. */
export type VividShade = `vivid-${ShadeColor}`;

/**
 * The shade of the dark theme: neutral gray, a dimmed or black gray, a tint of
 * a preset color, or a tint from `darkCustomColor`.
 */
export type DarkHue = "neutral" | "midnight" | "black" | ShadeColor | "custom";

/**
 * The shade of the light theme: plain white, a pale or a vivid tint of a preset
 * color, or a tint from `lightCustomColor`.
 */
export type LightHue = "white" | ShadeColor | VividShade | "custom";

/** Neutral and the two dimmed grays, then the colors, then the custom color. */
export const DARK_HUES: readonly DarkHue[] = [
  "neutral",
  "midnight",
  "black",
  ...SHADE_COLORS,
  "custom",
];

/** White, the pale colors, the vivid colors, then the custom color. */
export const LIGHT_HUES: readonly LightHue[] = [
  "white",
  ...SHADE_COLORS,
  ...SHADE_COLORS.map((color): VividShade => `vivid-${color}`),
  "custom",
];

/** The preset color of a shade, or null for a gray, white or custom shade. */
export function shadeColor(hue: DarkHue | LightHue): ShadeColor | null {
  const color = hue.startsWith("vivid-") ? hue.slice("vivid-".length) : hue;
  return Object.hasOwn(SHADE_COLOR_HUES, color) ? (color as ShadeColor) : null;
}

/**
 * The most that a dark shade can dim: the 900 step, the page of the board, goes
 * to black. The text steps do not dim (dark-shade.css). Thus, a darker page
 * only increases their contrast.
 */
export const MAX_DARK_DIM = 20.5;

/**
 * The most that a light shade can dim: the page at 88%, the lightness of the
 * 200 step of Tailwind. The text steps go down with the page
 * (light-shade.css), and `colors.test.ts` measures them at this dim. A darker
 * page would put the gray text under 4.5:1.
 */
export const MAX_LIGHT_DIM = 12;

/**
 * The most chroma of a custom shade. Past it, the page looks like a colored
 * sheet, and not like a theme.
 */
export const MAX_DARK_CUSTOM_CHROMA = 0.05;
export const MAX_LIGHT_CUSTOM_CHROMA = 0.1;

/** The start values of the custom colors: a deep blue gray, a warm paper. */
export const DEFAULT_DARK_CUSTOM_COLOR = "#1f2333";
export const DEFAULT_LIGHT_CUSTOM_COLOR = "#f4ecdc";

/** The chroma of the dark tints of the preset colors. */
const DARK_COLOR_CHROMA = 0.035;
/** The chroma and dim of the pale light tints. */
const PALE_CHROMA = 0.03;
/** Yellow needs more chroma than the other colors to look like a color. */
const PALE_YELLOW_CHROMA = 0.045;
const PALE_DIM = 2.5;
/**
 * The vivid light tints: the page at the 200 step, with chroma near that of
 * the 200 step of each color. sRGB holds less than this for red, orange, blue,
 * purple and pink at that lightness, and those get the most that it holds.
 */
const VIVID_CHROMA = 0.1;
const VIVID_DIM = MAX_LIGHT_DIM;

const NO_TINT: Tint = { chroma: 0, hue: 0, dim: 0 };

/**
 * The lightness of the surface of a light shade, which is the lightest step and
 * thus the one with the least room for chroma.
 */
function lightSurface(dim: number): number {
  return 1 - dim / 100;
}

/**
 * The lightness of the 800 step of a dark shade, the tone of its cards. The
 * 900 and 950 steps under it go to black with a high dim, where chroma does not
 * show.
 */
function darkCard(dim: number): number {
  return Math.max(0, 0.269 - (dim * 0.85) / 100);
}

/** The chroma, capped where sRGB clips it at the lightness of `surface`. */
function inGamutChroma(chroma: number, hue: number, surface: number): number {
  return Math.min(chroma, maxChroma(surface, hue));
}

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

const DARK_PRESETS: Record<Exclude<DarkHue, "custom">, Tint> = {
  neutral: NO_TINT,
  midnight: { chroma: 0, hue: 0, dim: 8 },
  black: { chroma: 0, hue: 0, dim: MAX_DARK_DIM },
  ...(Object.fromEntries(
    SHADE_COLORS.map((color) => [
      color,
      { chroma: DARK_COLOR_CHROMA, hue: SHADE_COLOR_HUES[color], dim: 0 },
    ]),
  ) as Record<ShadeColor, Tint>),
};

const LIGHT_PRESETS: Record<Exclude<LightHue, "custom">, Tint> = {
  white: NO_TINT,
  ...(Object.fromEntries(
    SHADE_COLORS.map((color) => [
      color,
      {
        chroma: color === "yellow" ? PALE_YELLOW_CHROMA : PALE_CHROMA,
        hue: SHADE_COLOR_HUES[color],
        dim: PALE_DIM,
      },
    ]),
  ) as Record<ShadeColor, Tint>),
  ...(Object.fromEntries(
    SHADE_COLORS.map((color) => {
      const hue = SHADE_COLOR_HUES[color];
      const chroma = inGamutChroma(VIVID_CHROMA, hue, lightSurface(VIVID_DIM));
      return [
        `vivid-${color}`,
        { chroma: round(chroma, 4), hue, dim: VIVID_DIM },
      ];
    }),
  ) as Record<VividShade, Tint>),
};

/**
 * A dark shade from a picked color. Its hue and chroma tint the ramp. Its
 * lightness sets the dim: a color darker than the page makes the page that
 * dark, to black. A lighter color does not make the page lighter, because the
 * text would lose contrast.
 */
export function customDarkTint(hex: string): Tint {
  const [lightness, chroma, hue] = hexToOklch(hex);
  const dim = Math.min(MAX_DARK_DIM, Math.max(0, 20.5 - lightness * 100));
  return {
    chroma: round(
      inGamutChroma(
        Math.min(chroma, MAX_DARK_CUSTOM_CHROMA),
        hue,
        darkCard(dim),
      ),
      4,
    ),
    hue: round(hue, 1),
    dim: round(dim, 2),
  };
}

/**
 * A light shade from a picked color, in the same way: hue and chroma, and a dim
 * from its lightness, to `MAX_LIGHT_DIM`. The chroma stops where sRGB stops at
 * the lightness of the page. Thus, a saturated pick gives the most color that
 * the page can show, in the hue that was picked.
 */
export function customLightTint(hex: string): Tint {
  const [lightness, chroma, hue] = hexToOklch(hex);
  const dim = Math.min(MAX_LIGHT_DIM, Math.max(0, 100 - lightness * 100));
  return {
    chroma: round(
      inGamutChroma(
        Math.min(chroma, MAX_LIGHT_CUSTOM_CHROMA),
        hue,
        lightSurface(dim),
      ),
      4,
    ),
    hue: round(hue, 1),
    dim: round(dim, 2),
  };
}

export function darkTint(hue: DarkHue, customHex: string): Tint {
  return hue === "custom" ? customDarkTint(customHex) : DARK_PRESETS[hue];
}

export function lightTint(hue: LightHue, customHex: string): Tint {
  return hue === "custom" ? customLightTint(customHex) : LIGHT_PRESETS[hue];
}

/** Each dim that a preset of the theme uses, for the contrast test. */
export function presetDims(theme: "light" | "dark"): number[] {
  const presets = theme === "light" ? LIGHT_PRESETS : DARK_PRESETS;
  return [...new Set(Object.values(presets).map((tint) => tint.dim))];
}

/**
 * The custom properties from which the stylesheet of the theme makes its ramp.
 * Set on <html> for the page, and on a swatch for a sample of one shade.
 */
export function tintProperties(
  theme: "light" | "dark",
  tint: Tint,
): Record<string, string> {
  return {
    [`--${theme}-tint-c`]: String(tint.chroma),
    [`--${theme}-tint-h`]: String(tint.hue),
    [`--${theme}-dim`]: `${tint.dim}%`,
  };
}
