import type { ComponentChildren } from "preact";

const selectedClass =
  "outline-2 outline-offset-2 outline-blue-500 dark:outline-blue-400";

/**
 * A custom color in Settings: the native picker under a round swatch that shows
 * what it holds, the same size as the preset swatches next to it. The rainbow
 * rim is what says "any color" before one is set. The board color, the pattern
 * color and the custom shades of the themes all use it. Thus, a custom color
 * looks the same wherever it is.
 *
 * `children` is the fill inside the rim, which draws the color as its place
 * draws it. It must fill the rim (`block w-full h-full rounded-full`).
 */
export function CustomColorSwatch({
  label,
  value,
  marked = false,
  onClick,
  onInput,
  children,
}: {
  label: string;
  value: string;
  /** If the custom color is the selected choice of its picker. */
  marked?: boolean | undefined;
  onClick?: (() => void) | undefined;
  onInput: (hex: string) => void;
  children: ComponentChildren;
}) {
  return (
    <label
      class={`relative block w-6 h-6 sm:w-7 sm:h-7 shrink-0 rounded-full cursor-pointer p-[3px] bg-[conic-gradient(#f87171,#facc15,#4ade80,#38bdf8,#a78bfa,#f472b6,#f87171)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-500 ${marked ? selectedClass : ""}`}
      title={label}
    >
      {children}
      <input
        type="color"
        class="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
        value={value}
        aria-label={label}
        onClick={onClick}
        onInput={(e) => onInput(e.currentTarget.value)}
      />
    </label>
  );
}
