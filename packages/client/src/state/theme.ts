import { computed, effect } from "@preact/signals";
import {
  darkTint,
  lightTint,
  type Tint,
  tintProperties,
} from "#/utils/themeShades.ts";
import type { ThemeMode } from "./prefParsers.ts";
import {
  darkCustomColor,
  darkHue,
  lightCustomColor,
  lightHue,
  theme,
} from "./prefs.ts";

// The theme on <html>: the `dark` class, and the tint of each theme as the
// custom properties from which its stylesheet makes the neutral ramp
// (styles/light-shade.css, styles/dark-shade.css). Both tints are always set.
// Thus, a change of theme needs nothing more than the class. The preferences
// themselves are in `prefs.ts`. `public/theme-init.js` sets the class before
// the first paint.

/** The tint of the light theme, from its preset or its custom color. */
export const appliedLightTint = computed<Tint>(() =>
  lightTint(lightHue.value, lightCustomColor.value),
);

/** The tint of the dark theme, in the same way. */
export const appliedDarkTint = computed<Tint>(() =>
  darkTint(darkHue.value, darkCustomColor.value),
);

function setProperties(properties: Record<string, string>) {
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(properties)) {
    style.setProperty(name, value);
  }
}

effect(() => {
  setProperties(tintProperties("light", appliedLightTint.value));
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
// ramp, so that a dark shade also tints it. A canvas changes that `oklch()`
// into the hex that each browser accepts there.
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

// The dark tint is set in the same effect as the class, before the bar reads
// the ramp. Two effects would run in an order that is not certain.
effect(() => {
  setProperties(tintProperties("dark", appliedDarkTint.value));
  applyTheme(theme.value);
});

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (theme.value === "system") applyTheme("system");
  });
