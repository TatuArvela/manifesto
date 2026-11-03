import { readFileSync } from "node:fs";
import { NoteColor } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { boardCard, boardLabel } from "#/components/boardCard.ts";
import {
  MAX_DARK_DIM,
  MAX_LIGHT_DIM,
  presetDims,
} from "#/utils/themeShades.ts";
import {
  autoNoteColorMap,
  noteColorMap,
  noteText,
  tagChipColors,
} from "./colors.ts";

// Read from disk. Vitest empties a stylesheet imported in a test, also with
// `?raw`.
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
// The palette as the build has it: the own Tailwind installation of the client.
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
 * A shade moves the lightness of the neutral ramp (its tint almost does not
 * change the contrast). Thus, the test reads each step back from the stylesheet
 * of the shade, with the dim of that shade in place of the variable.
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

/**
 * Each dim that a theme can have: those of its presets, and the ends of the
 * range of a custom color. The ramp only goes darker as the dim grows. Thus,
 * the ends cover a custom dim between them.
 */
const dims = (theme: Theme, max: number) => [
  ...new Set([0, ...presetDims(theme), max]),
];
const shades: { theme: Theme; dim: number }[] = [
  ...dims("light", MAX_LIGHT_DIM).map((dim) => ({
    theme: "light" as const,
    dim,
  })),
  ...dims("dark", MAX_DARK_DIM).map((dim) => ({
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

/**
 * The color that a utility list gives one property in one theme. An alpha from
 * a variable (`/(--note-alpha)`) is 100% unless a rule sets it, and the glossy
 * test sets it itself. Thus, it is dropped.
 */
function utility(classes: string, prefix: string, theme: Theme): string {
  const lead = theme === "dark" ? `dark:${prefix}-` : `${prefix}-`;
  const name = classes
    .split(/\s+/)
    .filter((c) => c.startsWith(lead))
    .map((c) => c.slice(lead.length).replace(/\/\(--[a-z-]+\)$/, ""))
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

  // A glossy or glass card shows the board through its color, and a glossy
  // card puts a sheen of white over it. The board can be any color. Thus, the
  // test puts each note over a black and a white board, which are the two
  // ends, after the filter of the glass, under no sheen and under the strongest
  // part of it.
  it.each(["glossy", "glass"])(
    "keeps the text and icons of a %s note legible over any board",
    (finish) => {
      const noteCss = read("./styles/note-cards.css");
      const ruleOf = (selector: string) => {
        const start = noteCss.indexOf(`${selector} {`);
        expect(start, selector).toBeGreaterThanOrEqual(0);
        return noteCss.slice(start, noteCss.indexOf("\n}", start));
      };
      /** The last rule of `rules` that sets `property`, or "". */
      const lastWith = (rules: string[], property: string) =>
        rules.filter((r) => r.includes(`${property}:`)).at(-1) ?? "";
      const finishOf = (...selectors: string[]) => {
        const rules = selectors.map(ruleOf);
        const alpha = /--note-alpha: ([\d.]+)%;/.exec(
          lastWith(rules, "--note-alpha"),
        )?.[1];
        expect(alpha, selectors[0]).toBeDefined();
        const sheens = [
          ...lastWith(rules, "background-image").matchAll(
            /rgb\(255 255 255 \/ ([\d.]+)\)/g,
          ),
        ].map(([, a = "0"]) => Number(a));
        const filter = lastWith(rules, "backdrop-filter");
        const amount = (name: string) =>
          Number(new RegExp(`${name}\\(([\\d.]+)\\)`).exec(filter)?.[1] ?? 1);
        // Each step of the ramp that the card moves, to the step that it reads.
        const moved = new Map(
          [
            ...rules
              .join("\n")
              .matchAll(/--color-(neutral-\d+): var\(--ramp-(\d+)\);/g),
          ].map(([, step = "", to = ""]) => [step, `neutral-${to}`]),
        );
        return {
          alpha: Number(alpha) / 100,
          sheens: [0, ...sheens],
          contrast: amount("contrast"),
          brightness: amount("brightness"),
          moved,
        };
      };
      const base = `:root[data-note-finish="${finish}"] .note-finish`;
      const looks: Record<Theme, ReturnType<typeof finishOf>> = {
        light: finishOf(
          base,
          `:root:not(.dark)[data-note-finish="${finish}"] .note-finish`,
        ),
        dark: finishOf(
          base,
          `:root.dark[data-note-finish="${finish}"] .note-finish`,
        ),
      };
      // Each step that a card reads is held on the root.
      for (const { moved } of Object.values(looks)) {
        expect(moved.size).toBeGreaterThan(2);
        for (const to of moved.values()) {
          expect(noteCss).toContain(
            `--ramp-${to.slice(8)}: var(--color-${to});`,
          );
        }
      }

      const mix = (top: number[], under: number[], a: number) =>
        top.map((v, i) => v * a + (under[i] ?? 0) * (1 - a));
      const clamp = (v: number) => Math.min(1, Math.max(0, v));
      const linear = (v: number) =>
        v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      const encoded = (v: number) =>
        v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
      /**
       * A board channel after `contrast()` and `brightness()`. A browser can
       * apply them to the encoded or to the linear value. Thus, both.
       */
      const filtered = (v: number, c: number, b: number) => {
        const f = (x: number) => clamp(clamp((x - 0.5) * c + 0.5) * b);
        return [f(v), encoded(f(linear(v)))];
      };

      const found: string[] = [];
      for (const { theme, dim } of shades) {
        const look = looks[theme];
        const tone = (classes: string) => {
          const [name = "", a] = utility(classes, "text", theme).split("/");
          const step = look.moved.get(name) ?? name;
          return a === undefined ? step : `${step}/${a}`;
        };
        const boards = [0, 1].flatMap((v) =>
          filtered(v, look.contrast, look.brightness),
        );
        for (const surface of noteSurfaces) {
          const name = utility(surface.classes, "bg", theme);
          // The surface of a note never reads a step that a card moves.
          expect(look.moved.has(name), `${surface.label} ${theme}`).toBe(false);
          const note = srgb(colour(name, theme, dim));
          for (const board of boards) {
            for (const sheen of look.sheens) {
              const bg = mix(
                [1, 1, 1],
                mix(note, [board, board, board], look.alpha),
                sheen,
              );
              for (const text of roles) {
                const fg = over(tone(text.classes), bg, theme, dim);
                const ratio = contrast(fg, bg);
                if (ratio < text.needs) {
                  found.push(
                    `${text.label} on ${finish} ${surface.label} over ${board.toFixed(2)}, sheen ${sheen}, ${theme} dim ${dim}%: ${ratio.toFixed(2)}`,
                  );
                }
              }
            }
          }
        }
      }
      expect([...new Set(found)]).toEqual([]);
    },
  );

  // A light shade tints `--color-white`. At the dim of a vivid shade, a tinted
  // white on a blue button is under 4.5:1. Thus, white text gets the true white
  // back (light-shade.css), and on that white the button passes.
  it("keeps white text on a primary button legible in each light shade", () => {
    expect(lightShade).toMatch(
      /html:not\(\.dark\)\s*:is\([^)]*\[class~="text-white"\][^{]*\{\s*--color-white: oklch\(100% 0 0\);/,
    );
    expect(colour("white", "light", MAX_LIGHT_DIM)[0]).toBeLessThan(0.9);
    const button = srgb(colour("blue-600", "light", 0));
    expect(contrast(srgb([1, 0, 0]), button)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps a tag's name legible on its chip", () => {
    const chips = Object.entries(tagChipColors).map(([color, { bg }]) => ({
      label: `${color} tag`,
      classes: bg,
    }));
    expect(failures(chips, [body])).toEqual([]);
  });

  it("keeps text on a board card legible over any board", () => {
    // Opaque. Thus, no board, picture or texture behind it shows through.
    expect(boardCard).not.toMatch(/\bbg-[a-z]+(-\d+)?\//);
    const surface = [{ label: "board card", classes: boardCard }];
    expect(failures(surface, roles)).toEqual([]);
  });

  it("keeps a section heading legible over any board", () => {
    // Drawn on `--board-page`, which is the white or neutral-900 of the page.
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
