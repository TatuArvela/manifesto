import { NoteColor, NoteFont } from "@manifesto/shared";

export interface ColorClasses {
  bg: string;
  hover: string;
  border: string;
  ring: string;
  toggleTrack: string;
}

export const noteColorMap: Record<NoteColor, ColorClasses> = {
  [NoteColor.Default]: {
    bg: "bg-white dark:bg-neutral-800",
    hover: "hover:bg-neutral-50 dark:hover:bg-neutral-750",
    border: "border-neutral-200 dark:border-neutral-700",
    ring: "ring-neutral-300 dark:ring-neutral-600",
    toggleTrack: "bg-neutral-100 dark:bg-neutral-700",
  },
  [NoteColor.Red]: {
    bg: "bg-red-100 dark:bg-red-900",
    hover: "hover:bg-red-200 dark:hover:bg-red-800",
    border: "border-transparent",
    ring: "ring-red-300 dark:ring-red-700",
    toggleTrack: "bg-red-200 dark:bg-red-800",
  },
  [NoteColor.Orange]: {
    bg: "bg-orange-100 dark:bg-orange-900",
    hover: "hover:bg-orange-200 dark:hover:bg-orange-800",
    border: "border-transparent",
    ring: "ring-orange-300 dark:ring-orange-700",
    toggleTrack: "bg-orange-200 dark:bg-orange-800",
  },
  [NoteColor.Yellow]: {
    bg: "bg-yellow-100 dark:bg-yellow-900",
    hover: "hover:bg-yellow-200 dark:hover:bg-yellow-800",
    border: "border-transparent",
    ring: "ring-yellow-300 dark:ring-yellow-700",
    toggleTrack: "bg-yellow-200 dark:bg-yellow-800",
  },
  [NoteColor.Green]: {
    bg: "bg-green-100 dark:bg-green-900",
    hover: "hover:bg-green-200 dark:hover:bg-green-800",
    border: "border-transparent",
    ring: "ring-green-300 dark:ring-green-700",
    toggleTrack: "bg-green-200 dark:bg-green-800",
  },
  [NoteColor.Teal]: {
    bg: "bg-teal-100 dark:bg-teal-900",
    hover: "hover:bg-teal-200 dark:hover:bg-teal-800",
    border: "border-transparent",
    ring: "ring-teal-300 dark:ring-teal-700",
    toggleTrack: "bg-teal-200 dark:bg-teal-800",
  },
  [NoteColor.Blue]: {
    bg: "bg-blue-100 dark:bg-blue-900",
    hover: "hover:bg-blue-200 dark:hover:bg-blue-800",
    border: "border-transparent",
    ring: "ring-blue-300 dark:ring-blue-700",
    toggleTrack: "bg-blue-200 dark:bg-blue-800",
  },
  [NoteColor.Purple]: {
    bg: "bg-purple-100 dark:bg-purple-900",
    hover: "hover:bg-purple-200 dark:hover:bg-purple-800",
    border: "border-transparent",
    ring: "ring-purple-300 dark:ring-purple-700",
    toggleTrack: "bg-purple-200 dark:bg-purple-800",
  },
  [NoteColor.Pink]: {
    bg: "bg-pink-100 dark:bg-pink-900",
    hover: "hover:bg-pink-200 dark:hover:bg-pink-800",
    border: "border-transparent",
    ring: "ring-pink-300 dark:ring-pink-700",
    toggleTrack: "bg-pink-200 dark:bg-pink-800",
  },
  [NoteColor.Brown]: {
    bg: "bg-amber-100 dark:bg-amber-900",
    hover: "hover:bg-amber-200 dark:hover:bg-amber-800",
    border: "border-transparent",
    ring: "ring-amber-300 dark:ring-amber-700",
    toggleTrack: "bg-amber-200 dark:bg-amber-800",
  },
  [NoteColor.Gray]: {
    bg: "bg-neutral-200 dark:bg-neutral-700",
    hover: "hover:bg-neutral-300 dark:hover:bg-neutral-600",
    border: "border-transparent",
    ring: "ring-neutral-400 dark:ring-neutral-500",
    toggleTrack: "bg-neutral-300 dark:bg-neutral-600",
  },
};

/**
 * Auto-note variant: lighter background with a thick colored border so
 * generated notes are visually distinct from user notes at a glance.
 */
export const autoNoteColorMap: Record<
  NoteColor,
  Pick<ColorClasses, "bg" | "border">
> = {
  [NoteColor.Default]: {
    bg: "bg-white dark:bg-neutral-900",
    border: "border-4 border-neutral-200 dark:border-neutral-700",
  },
  [NoteColor.Red]: {
    bg: "bg-red-50 dark:bg-red-950",
    border: "border-4 border-red-200 dark:border-red-800",
  },
  [NoteColor.Orange]: {
    bg: "bg-orange-50 dark:bg-orange-950",
    border: "border-4 border-orange-200 dark:border-orange-800",
  },
  [NoteColor.Yellow]: {
    bg: "bg-yellow-50 dark:bg-yellow-950",
    border: "border-4 border-yellow-200 dark:border-yellow-800",
  },
  [NoteColor.Green]: {
    bg: "bg-green-50 dark:bg-green-950",
    border: "border-4 border-green-200 dark:border-green-800",
  },
  [NoteColor.Teal]: {
    bg: "bg-teal-50 dark:bg-teal-950",
    border: "border-4 border-teal-200 dark:border-teal-800",
  },
  [NoteColor.Blue]: {
    bg: "bg-blue-50 dark:bg-blue-950",
    border: "border-4 border-blue-200 dark:border-blue-800",
  },
  [NoteColor.Purple]: {
    bg: "bg-purple-50 dark:bg-purple-950",
    border: "border-4 border-purple-200 dark:border-purple-800",
  },
  [NoteColor.Pink]: {
    bg: "bg-pink-50 dark:bg-pink-950",
    border: "border-4 border-pink-200 dark:border-pink-800",
  },
  [NoteColor.Brown]: {
    bg: "bg-amber-50 dark:bg-amber-950",
    border: "border-4 border-amber-200 dark:border-amber-800",
  },
  [NoteColor.Gray]: {
    bg: "bg-neutral-100 dark:bg-neutral-800",
    border: "border-4 border-neutral-300 dark:border-neutral-600",
  },
};

export const noteFontFamilies: Record<NoteFont, string> = {
  [NoteFont.Default]: "",
  [NoteFont.PermanentMarker]: '"Permanent Marker", cursive',
  [NoteFont.ComicRelief]: '"Comic Relief", cursive',
};

export const colorPickerSwatches: { value: NoteColor; swatch: string }[] = [
  {
    value: NoteColor.Default,
    swatch:
      "bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600",
  },
  { value: NoteColor.Red, swatch: "bg-red-400 dark:bg-red-600" },
  { value: NoteColor.Orange, swatch: "bg-orange-400 dark:bg-orange-600" },
  { value: NoteColor.Yellow, swatch: "bg-yellow-400 dark:bg-yellow-600" },
  { value: NoteColor.Green, swatch: "bg-green-400 dark:bg-green-600" },
  { value: NoteColor.Teal, swatch: "bg-teal-400 dark:bg-teal-600" },
  { value: NoteColor.Blue, swatch: "bg-blue-400 dark:bg-blue-600" },
  { value: NoteColor.Purple, swatch: "bg-purple-400 dark:bg-purple-600" },
  { value: NoteColor.Pink, swatch: "bg-pink-400 dark:bg-pink-600" },
  { value: NoteColor.Brown, swatch: "bg-amber-600 dark:bg-amber-700" },
  { value: NoteColor.Gray, swatch: "bg-neutral-400 dark:bg-neutral-500" },
];
