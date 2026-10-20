import { noteScale } from "#/state/prefs.ts";

/**
 * The number of columns of the board by viewport width, for big notes (the
 * default). Each step keeps a card at approximately the same width
 * (approximately 250px). Thus, a wider screen gets more notes, not larger
 * notes. styles.css defines the breakpoints after `2xl`.
 */
const GRID_COLUMNS_BIG =
  "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 4xl:grid-cols-7 5xl:grid-cols-8 6xl:grid-cols-9 7xl:grid-cols-10";

/**
 * The same for small notes: approximately 180px for each card. Thus,
 * approximately half as many again in a row, and two next to each other also on
 * a phone.
 */
const GRID_COLUMNS_SMALL =
  "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 3xl:grid-cols-9 4xl:grid-cols-10 5xl:grid-cols-12 6xl:grid-cols-13 7xl:grid-cols-15";

/**
 * The column classes for the grid. All grids of cards share them, and also the
 * ruler with which `NoteInput` measures a column. Thus, they can never
 * disagree. It reads the note scale preference. Thus, call it in render.
 */
export function gridColumns(): string {
  return noteScale.value === "small" ? GRID_COLUMNS_SMALL : GRID_COLUMNS_BIG;
}
