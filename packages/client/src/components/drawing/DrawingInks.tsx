import { NoteColor } from "@manifesto/shared";
import { Repeat2 } from "lucide-preact";
import { useState } from "preact/hooks";
import { Tooltip } from "#/components/Tooltip.tsx";
import { getColorLabel, t } from "#/i18n/index.ts";
import { SidePanel } from "./SidePanel.tsx";

/** The shades of a family of inks, from dark to pale. */
type Shade = "dark" | "base" | "light" | "pale";

/**
 * A family of inks: its name (that of a note color), and its four shades.
 * The base shades are the inks from before the families, and the ones that a
 * phone shows.
 */
const FAMILIES: readonly {
  name: NoteColor;
  shades: readonly [dark: string, base: string, light: string, pale: string];
}[] = [
  {
    name: NoteColor.Gray,
    shades: ["#171717", "#737373", "#d4d4d4", "#ffffff"],
  },
  {
    name: NoteColor.Brown,
    shades: ["#451a03", "#92400e", "#c08552", "#e7d3b8"],
  },
  { name: NoteColor.Red, shades: ["#991b1b", "#dc2626", "#f87171", "#fecaca"] },
  {
    name: NoteColor.Pink,
    shades: ["#9d174d", "#db2777", "#f472b6", "#fbcfe8"],
  },
  {
    name: NoteColor.Orange,
    shades: ["#9a3412", "#ea580c", "#fb923c", "#fed7aa"],
  },
  {
    name: NoteColor.Yellow,
    shades: ["#a16207", "#facc15", "#fef08a", "#fefce8"],
  },
  {
    name: NoteColor.Green,
    shades: ["#166534", "#16a34a", "#4ade80", "#bbf7d0"],
  },
  {
    name: NoteColor.Teal,
    shades: ["#115e59", "#0d9488", "#2dd4bf", "#99f6e4"],
  },
  {
    name: NoteColor.Blue,
    shades: ["#1e40af", "#2563eb", "#60a5fa", "#bfdbfe"],
  },
  {
    name: NoteColor.Purple,
    shades: ["#6b21a8", "#9333ea", "#c084fc", "#e9d5ff"],
  },
];

const SHADES: readonly Shade[] = ["dark", "base", "light", "pale"];

/**
 * The name of an ink. The gray family has the names of its own: its dark
 * shade is black, and its pale shade white.
 */
function inkLabel(family: NoteColor, shade: Shade): string {
  if (family === NoteColor.Gray && shade === "dark") return t("drawing.black");
  if (family === NoteColor.Gray && shade === "pale") return t("drawing.white");
  const name = getColorLabel(family);
  if (shade === "base") return name;
  const lower = name.toLocaleLowerCase();
  if (family === NoteColor.Gray) return t("drawing.lightInk", { name: lower });
  return t(
    shade === "dark"
      ? "drawing.darkInk"
      : shade === "light"
        ? "drawing.lightInk"
        : "drawing.paleInk",
    { name: lower },
  );
}

/**
 * All inks, in the order of the grid: two families on each row, each from
 * dark to pale. `phone` marks the inks that the row on a phone shows.
 */
export const INKS = FAMILIES.flatMap((family) =>
  family.shades.map((color, at) => {
    const shade = SHADES[at] ?? "base";
    return {
      color,
      label: () => inkLabel(family.name, shade),
      phone: shade === "base" || family.name === NoteColor.Gray,
    };
  }),
);

/** The inks that a new drawing starts with. */
export const BLACK = "#171717";
export const WHITE = "#ffffff";

// A round ink with a light ring and a dark gap: a black ink shows on the dark
// bar, and the two inks stay apart where they overlap. The browser gives a
// color field a border and padding of its own, with square corners behind the
// round swatch. Thus, both are removed.
const colorField =
  "absolute w-8 h-8 appearance-none overflow-hidden rounded-full border-0 p-0 cursor-pointer bg-transparent shadow-[0_0_0_2px_#737373,0_0_0_4px_#171717] [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0";

/** A hex color with 3 or 6 digits, with or without its `#`. */
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The ink that a hex color names, as `#rrggbb`. Null when it is not one. */
export function parseHex(text: string): string | null {
  const digits = HEX.exec(text.trim())?.[1]?.toLowerCase();
  if (!digits) return null;
  return digits.length === 3
    ? `#${[...digits].map((digit) => digit + digit).join("")}`
    : `#${digits}`;
}

/**
 * The field that takes the hex color of an ink. A complete color applies as
 * it is typed. Enter or a move of focus away puts back the text of the ink
 * when the text is not a color.
 */
function HexField({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (color: string) => void;
}) {
  const [text, setText] = useState(value);
  const [typing, setTyping] = useState(false);
  return (
    <input
      type="text"
      class="w-24 min-w-0 rounded-md bg-neutral-900 px-2 py-1 font-mono text-sm text-neutral-100 outline-none ring-1 ring-white/20 focus-visible:ring-blue-400"
      value={typing ? text : value}
      maxLength={7}
      spellcheck={false}
      autocomplete="off"
      aria-label={label}
      onFocus={() => {
        setText(value);
        setTyping(true);
      }}
      onInput={(event) => {
        const next = event.currentTarget.value;
        setText(next);
        const color = parseHex(next);
        if (color) onChange(color);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      onBlur={() => setTyping(false)}
    />
  );
}

/**
 * The two inks: the foreground over the background, and the button that
 * swaps them. Each ink is a color field for any other ink, and shows the ink
 * in use. On a phone in the row of colors, on a wide screen under the tools.
 */
export function InkPair({
  where,
  ink,
  onInk,
  backInk,
  onBackInk,
  onSwap,
}: {
  /** The classes that show it on a phone or on a wide screen. */
  where: string;
  ink: string;
  onInk: (color: string) => void;
  backInk: string;
  onBackInk: (color: string) => void;
  onSwap: () => void;
}) {
  return (
    <span class={`${where} relative w-12 h-12 shrink-0`}>
      <input
        type="color"
        class={`${colorField} left-0 top-0 z-1`}
        value={ink}
        onInput={(event) => onInk(event.currentTarget.value)}
        aria-label={t("drawing.foreground")}
      />
      <input
        type="color"
        class={`${colorField} right-0 bottom-0`}
        value={backInk}
        onInput={(event) => onBackInk(event.currentTarget.value)}
        aria-label={t("drawing.background")}
      />
      <span class="absolute right-0 top-0">
        <Tooltip label={t("drawing.swapColors")}>
          <button
            type="button"
            class="relative flex items-center justify-center w-4 h-4 rounded-sm text-neutral-300 hover:text-white cursor-pointer after:absolute after:-inset-1"
            onClick={onSwap}
            aria-label={t("drawing.swapColors")}
          >
            <Repeat2 class="w-4 h-4" />
          </button>
        </Tooltip>
      </span>
    </span>
  );
}

/**
 * The colors to draw with: a field for the hex color of the foreground ink,
 * and a palette under it. A color sets the foreground ink; with a right
 * click, the background ink. On a wide screen, a grid of all inks: two
 * families on each row, from dark to pale. On a phone, one row of the base
 * shades, and all of the grays.
 */
export function DrawingColors({
  ink,
  onInk,
  onBackInk,
}: {
  ink: string;
  onInk: (color: string) => void;
  onBackInk: (color: string) => void;
}) {
  return (
    <SidePanel
      label={t("drawing.colors")}
      class="flex flex-col items-center gap-2 md:block md:rounded-lg md:bg-neutral-800 md:p-2"
    >
      <div class="md:px-1 md:pb-2">
        <HexField value={ink} label={t("drawing.hexColor")} onChange={onInk} />
      </div>
      <div class="flex flex-wrap justify-center gap-0.5 md:grid md:grid-cols-8 md:justify-items-center md:gap-1 md:[&>:nth-child(8n+5)]:ml-1">
        {INKS.map(({ color, label, phone }) => (
          <button
            key={color}
            type="button"
            class={`${phone ? "" : "hidden md:block "}w-6 h-6 rounded-full cursor-pointer ${ink === color ? "ring-2 ring-blue-400 ring-offset-2 ring-offset-neutral-900 md:ring-offset-neutral-800" : "ring-1 ring-white/30"}`}
            style={{ backgroundColor: color }}
            onClick={() => onInk(color)}
            onContextMenu={(event) => {
              event.preventDefault();
              onBackInk(color);
            }}
            aria-label={label()}
            aria-pressed={ink === color}
          />
        ))}
      </div>
    </SidePanel>
  );
}
