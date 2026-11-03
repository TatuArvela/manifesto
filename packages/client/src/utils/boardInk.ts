/**
 * The colors and the opacity of the board pattern (Settings > Board
 * Background > Pattern Color, Pattern Opacity).
 */

/**
 * The colorful pattern colors, as the vivid shades of the note colors. Drawn
 * translucent, as a custom color is. Thus, one shade is visible on light and
 * dark.
 */
export const INK_COLORS = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  teal: "#14b8a6",
  blue: "#3b82f6",
  purple: "#a855f7",
  pink: "#ec4899",
} as const;

export type InkColor = keyof typeof INK_COLORS;

/** Each pattern color other than the own color of the theme. */
export type PickedInkChoice = "white" | "black" | InkColor | "custom";

/**
 * The opacity of the pattern, in percent: one value for each texture, gradient
 * or picture, and each color. Thus, the slider in Settings means the same,
 * whichever is selected.
 */
export const MIN_TEXTURE_OPACITY = 0;

export const MAX_TEXTURE_OPACITY = 100;

export const DEFAULT_TEXTURE_OPACITY = 10;

/**
 * The color in which a selected pattern color draws, as `#rrggbb`. `customHex`
 * is a validated `#rrggbb`.
 */
export function inkHex(choice: PickedInkChoice, customHex: string): string {
  if (choice === "white") return "#ffffff";
  if (choice === "black") return "#000000";
  return choice === "custom" ? customHex : INK_COLORS[choice];
}
