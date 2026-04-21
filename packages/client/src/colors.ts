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
    bg: "bg-white dark:bg-gray-800",
    hover: "hover:bg-gray-50 dark:hover:bg-gray-750",
    border: "border-gray-200 dark:border-gray-700",
    ring: "ring-gray-300 dark:ring-gray-600",
    toggleTrack: "bg-gray-100 dark:bg-gray-700",
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
    bg: "bg-gray-200 dark:bg-gray-700",
    hover: "hover:bg-gray-300 dark:hover:bg-gray-600",
    border: "border-transparent",
    ring: "ring-gray-400 dark:ring-gray-500",
    toggleTrack: "bg-gray-300 dark:bg-gray-600",
  },
};

/** Hex edge colors for the note stack base gradient */
export const noteEdgeColors: Record<
  NoteColor,
  { light: string; dark: string }
> = {
  [NoteColor.Default]: { light: "#d1d5db", dark: "#4b5563" },
  [NoteColor.Red]: { light: "#fca5a5", dark: "#991b1b" },
  [NoteColor.Orange]: { light: "#fdba74", dark: "#9a3412" },
  [NoteColor.Yellow]: { light: "#fde047", dark: "#854d0e" },
  [NoteColor.Green]: { light: "#86efac", dark: "#166534" },
  [NoteColor.Teal]: { light: "#5eead4", dark: "#115e59" },
  [NoteColor.Blue]: { light: "#93c5fd", dark: "#1e40af" },
  [NoteColor.Purple]: { light: "#c4b5fd", dark: "#5b21b6" },
  [NoteColor.Pink]: { light: "#f9a8d4", dark: "#9d174d" },
  [NoteColor.Brown]: { light: "#d97706", dark: "#78350f" },
  [NoteColor.Gray]: { light: "#9ca3af", dark: "#374151" },
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
      "bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600",
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
  { value: NoteColor.Gray, swatch: "bg-gray-400 dark:bg-gray-500" },
];
