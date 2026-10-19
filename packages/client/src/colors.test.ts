import { readFileSync } from "node:fs";
import { NoteColor } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { boardCard, boardLabel } from "#/components/boardCard.ts";
import {
  autoNoteColorMap,
  noteColorMap,
  noteText,
  tagChipColors,
} from "./colors.ts";

// Read from disk: Vitest blanks a stylesheet imported in a test, `?raw` too.
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
// The palette as the build has it: the client's own Tailwind install.
const tailwindTheme = read("../node_modules/tailwindcss/theme.css");
const lightShade = read("./styles/light-shade.css");
const darkShade = read("./styles/dark-shade.css");
const indexHtml = read("../index.html");

type Theme = "light" | "dark";
type Oklch = [lightness: number, chroma: number, hue: number];

const palette = new Map<string, Oklch>([
  ["white", [1, 0, 0]],
  ["black", [0, 0, 0]],
]);
for (const [, name = "", l = "", c = "", h = ""] of tailwindTheme.matchAll(
  /--color-([a-z]+-\d+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+|none)\)/g,
)) {
  palette.set(name, [Number(l) / 100, Number(c), h === "none" ? 0 : Number(h)]);
}

/**
 * A shade moves the neutral ramp's lightness (its tint barely moves the
 * contrast), so each step is read back from the shade's stylesheet with that
 * shade's dim in place of the variable.
 */
function shadedLightness(
  css: string,
  scope: string,
  variable: string,
  step: string,
  dim: number,
): number | undefined {
  const block = css.slice(css.indexOf(scope));
  const value = new RegExp(`--color-${step}:\\s*oklch\\(\\s*([^\\n]+)`).exec(
    block,
  )?.[1];
  if (value === undefined) return undefined;
  const parts = new RegExp(
    `^(max\\(0%,\\s*)?(?:calc\\()?([\\d.]+)%(?:\\s*-\\s*var\\(--${variable}\\)(?:\\s*\\*\\s*([\\d.]+))?)?`,
  ).exec(value);
  if (!parts) return undefined;
  const [, floored, base = "", factor = "1"] = parts;
  const taken = value.includes(`var(--${variable})`) ? dim * Number(factor) : 0;
  const lightness = (Number(base) - taken) / 100;
  return floored ? Math.max(0, lightness) : lightness;
}

const dims = (css: string, variable: string) => [
  ...new Set(
    [...css.matchAll(new RegExp(`--${variable}:\\s*([\\d.]+)%`, "g"))].map(
      ([, dim = "0"]) => Number(dim),
    ),
  ),
];
const shades: { theme: Theme; dim: number }[] = [
  ...dims(lightShade, "light-dim").map((dim) => ({
    theme: "light" as const,
    dim,
  })),
  ...dims(darkShade, "dark-dim").map((dim) => ({
    theme: "dark" as const,
    dim,
  })),
];

function colour(name: string, theme: Theme, dim: number): Oklch {
  const base = palette.get(name);
  if (base === undefined) throw new Error(`no colour ${name}`);
  if (!(name === "white" || name.startsWith("neutral-"))) return base;
  const [css, scope, variable] =
    theme === "light"
      ? [lightShade, "html:not(.dark)", "light-dim"]
      : [darkShade, "html.dark", "dark-dim"];
  const lightness = shadedLightness(css, scope, variable, name, dim);
  return lightness === undefined ? base : [lightness, base[1], base[2]];
}

function srgb([l, c, h]: Oklch): number[] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ];
  const [x = 0, y = 0, z = 0] = lms;
  return [
    4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z,
    -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z,
    -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z,
  ].map((v) => {
    const clipped = Math.min(1, Math.max(0, v));
    return clipped <= 0.0031308
      ? 12.92 * clipped
      : 1.055 * clipped ** (1 / 2.4) - 0.055;
  });
}

function luminance(rgb: number[]): number {
  const [r = 0, g = 0, b = 0] = rgb.map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number[], b: number[]): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** The colour a utility list gives one property in one theme. */
function utility(classes: string, prefix: string, theme: Theme): string {
  const lead = theme === "dark" ? `dark:${prefix}-` : `${prefix}-`;
  const name = classes
    .split(/\s+/)
    .filter((c) => c.startsWith(lead))
    .map((c) => c.slice(lead.length))
    .find((value) => palette.has(value.split("/")[0] ?? ""));
  if (name === undefined) throw new Error(`no ${prefix} in ${classes}`);
  return name;
}

/** Composites `fg` at its `/alpha` over an opaque `bg`, as the browser does. */
function over(fg: string, bg: number[], theme: Theme, dim: number): number[] {
  const [name = "", alpha = "100"] = fg.split("/");
  const rgb = srgb(colour(name, theme, dim));
  const a = Number(alpha) / 100;
  return rgb.map((v, i) => v * a + (bg[i] ?? 0) * (1 - a));
}

const bodyText =
  /<body class="([^"]+)"/.exec(indexHtml)?.[1] ?? "missing <body> class";

const noteSurfaces = Object.values(NoteColor).flatMap((color) => [
  { label: `${color} note`, classes: noteColorMap[color].bg },
  { label: `${color} auto-note`, classes: autoNoteColorMap[color].bg },
]);

const body = { label: "title and body", classes: bodyText, needs: 4.5 };
const roles = [
  body,
  { label: "read text", classes: noteText.read, needs: 4.5 },
  { label: "quiet text", classes: noteText.quiet, needs: 4.5 },
  { label: "resting icon", classes: noteText.icon, needs: 3 },
];

function failures(
  surfaces: { label: string; classes: string }[],
  texts: { label: string; classes: string; needs: number }[],
): string[] {
  const found: string[] = [];
  for (const { theme, dim } of shades) {
    for (const surface of surfaces) {
      const bg = srgb(
        colour(utility(surface.classes, "bg", theme), theme, dim),
      );
      for (const text of texts) {
        const fg = over(utility(text.classes, "text", theme), bg, theme, dim);
        const ratio = contrast(fg, bg);
        if (ratio < text.needs) {
          found.push(
            `${text.label} on ${surface.label}, ${theme} dim ${dim}%: ${ratio.toFixed(2)}`,
          );
        }
      }
    }
  }
  return found;
}

describe("contrast on notes", () => {
  it("reads every colour from the theme", () => {
    expect(palette.get("red-100")).toBeDefined();
    expect(shades.filter((s) => s.theme === "light").length).toBeGreaterThan(1);
    expect(shades.filter((s) => s.theme === "dark").length).toBeGreaterThan(1);
  });

  it("follows a shade's dim through the neutral ramp", () => {
    expect(colour("neutral-800", "dark", 20.5)[0]).toBeCloseTo(
      0.269 - 0.205 * 0.85,
    );
    expect(colour("white", "light", 2.5)[0]).toBeCloseTo(0.975);
    expect(colour("red-900", "dark", 20.5)[0]).toBeCloseTo(0.396);
  });

  it("keeps a note's text and icons legible on every colour and shade", () => {
    expect(failures(noteSurfaces, roles)).toEqual([]);
  });

  it("keeps a tag's name legible on its chip", () => {
    const chips = Object.entries(tagChipColors).map(([color, { bg }]) => ({
      label: `${color} tag`,
      classes: bg,
    }));
    expect(failures(chips, [body])).toEqual([]);
  });

  it("keeps text on a board card legible over any board", () => {
    // Opaque, so no board, picture or texture behind it shows through.
    expect(boardCard).not.toMatch(/\bbg-[a-z]+(-\d+)?\//);
    const surface = [{ label: "board card", classes: boardCard }];
    expect(failures(surface, roles)).toEqual([]);
  });

  it("keeps a section heading legible over any board", () => {
    // Drawn on `--board-page`, which is the page's white or neutral-900.
    expect(boardLabel).toContain("bg-(--board-page)");
    const page = [
      { label: "the page", classes: "bg-white dark:bg-neutral-900" },
    ];
    const heading = {
      label: "section heading",
      classes: boardLabel,
      needs: 4.5,
    };
    expect(failures(page, [heading])).toEqual([]);
  });
});
