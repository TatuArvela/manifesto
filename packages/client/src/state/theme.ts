import { effect } from "@preact/signals";
import type { ThemeMode } from "./prefParsers.ts";
import { darkHue, lightHue, theme } from "./prefs.ts";

// The theme on <html>: the `dark` class, and the shade of each theme as an
// attribute from which its stylesheet makes the neutral ramp
// (styles/light-shade.css, styles/dark-shade.css). The preferences themselves
// are in `prefs.ts`. `public/theme-init.js` sets the class before the first
// paint.

// Published as an attribute on <html>, not a class. Thus, the stylesheet can
// set one `--dark-tint-*` pair from it. The dark neutral ramp comes from that
// pair. Thus, each `neutral` utility in the app gets the new tint at the same
// time.
effect(() => {
  document.documentElement.dataset.darkHue = darkHue.value;
});

// The equivalent for the light theme, set in the same way. `--light-tint-*`
// control the light neutral ramp, and the white on which the page is drawn.
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

// The bar of the browser (`<meta name="theme-color">`) keeps the brand color in
// the light theme. In the dark theme, a blue bar over a dark header is too
// bright. Thus, it takes the own background of the header, read from the live
// ramp, so that a dark hue also tints it. A canvas changes that `oklch()` into
// the hex that each browser accepts there.
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
  // Read, so that a change of dark hue also paints the bar again.
  void darkHue.value;
  applyTheme(theme.value);
});

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (theme.value === "system") applyTheme("system");
  });
