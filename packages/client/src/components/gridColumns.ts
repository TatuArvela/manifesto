import { noteScale } from "../state/index.js";

/**
 * The board's column count by viewport width, for big notes (the default).
 * Each step keeps a card near the same width (about 250px), so a wider screen
 * gets more notes rather than bigger ones. The breakpoints past `2xl` are
 * defined in styles.css.
 */
const GRID_COLUMNS_BIG =
  "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 4xl:grid-cols-7 5xl:grid-cols-8 6xl:grid-cols-9 7xl:grid-cols-10";

/**
 * The same for small notes: about 180px a card, so roughly half as many again
 * to a row, and two side by side even on a phone.
 */
const GRID_COLUMNS_SMALL =
  "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 3xl:grid-cols-9 4xl:grid-cols-10 5xl:grid-cols-12 6xl:grid-cols-13 7xl:grid-cols-15";

/**
 * The column classes for the grid, shared by every grid of cards and by the
 * ruler `NoteInput` measures a column with, so they can never disagree. Reads
 * the note scale preference, so call it in render.
 */
export function gridColumns(): string {
  return noteScale.value === "small" ? GRID_COLUMNS_SMALL : GRID_COLUMNS_BIG;
}
