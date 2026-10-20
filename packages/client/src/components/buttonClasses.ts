// The text buttons of the app: one shape, a tone for what the button does, and
// a size for its location. Each text button gets its classes from here. Thus,
// to change how buttons look, change this file.

export type ButtonTone = "primary" | "secondary" | "danger" | "quiet";
export type ButtonSize = "md" | "sm" | "xs";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed";

const tones: Record<ButtonTone, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  secondary:
    "bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600",
  danger: "bg-red-600 text-white hover:bg-red-700",
  quiet: "hover:bg-black/5 dark:hover:bg-white/5",
};

const sizes: Record<ButtonSize, string> = {
  md: "px-4 py-2 text-sm",
  sm: "px-3 py-1.5 text-sm",
  xs: "px-3 py-1 text-xs",
};

export function buttonClass(tone: ButtonTone, size: ButtonSize = "md"): string {
  return `${base} ${tones[tone]} ${sizes[size]}`;
}
