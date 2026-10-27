import { NoteColor } from "@manifesto/shared";
import { Repeat2 } from "lucide-preact";
import { Tooltip } from "#/components/Tooltip.tsx";
import { getColorLabel, t } from "#/i18n/index.ts";
import { SidePanel } from "./SidePanel.tsx";

export const INKS = [
  { color: "#171717", name: null },
  { color: "#ffffff", name: "white" },
  { color: "#737373", name: NoteColor.Gray },
  { color: "#dc2626", name: NoteColor.Red },
  { color: "#ea580c", name: NoteColor.Orange },
  { color: "#facc15", name: NoteColor.Yellow },
  { color: "#16a34a", name: NoteColor.Green },
  { color: "#0d9488", name: NoteColor.Teal },
  { color: "#2563eb", name: NoteColor.Blue },
  { color: "#9333ea", name: NoteColor.Purple },
  { color: "#db2777", name: NoteColor.Pink },
  { color: "#92400e", name: NoteColor.Brown },
] as const;

// A round ink with a light ring and a dark gap: a black ink shows on the dark
// bar, and the two inks stay apart where they overlap. The browser gives a
// color field a border and padding of its own, with square corners behind the
// round swatch. Thus, both are removed.
const colorField =
  "absolute w-8 h-8 appearance-none overflow-hidden rounded-full border-0 p-0 cursor-pointer bg-transparent shadow-[0_0_0_2px_#737373,0_0_0_4px_#171717] [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0";

const inkLabel = (name: (typeof INKS)[number]["name"]) =>
  name === null
    ? t("drawing.black")
    : name === "white"
      ? t("drawing.white")
      : getColorLabel(name);

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
 * The colors to draw with. A color sets the foreground ink; with a right
 * click, the background ink.
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
      class="md:rounded-lg md:bg-neutral-800 md:p-2"
    >
      <div class="flex flex-wrap justify-center gap-0.5 md:grid md:grid-cols-6 md:justify-items-center md:gap-2">
        {INKS.map(({ color, name }) => (
          <button
            key={color}
            type="button"
            class={`w-6 h-6 md:w-7 md:h-7 rounded-full cursor-pointer ${ink === color ? "ring-2 ring-blue-400 ring-offset-2 ring-offset-neutral-900 md:ring-offset-neutral-800" : "ring-1 ring-white/30"}`}
            style={{ backgroundColor: color }}
            onClick={() => onInk(color)}
            onContextMenu={(event) => {
              event.preventDefault();
              onBackInk(color);
            }}
            aria-label={inkLabel(name)}
            aria-pressed={ink === color}
          />
        ))}
      </div>
    </SidePanel>
  );
}
