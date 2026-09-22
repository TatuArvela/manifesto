/**
 * The board's column count by viewport width, shared by the grid and the
 * ruler `NoteInput` measures a column with, so the two can never disagree.
 * Each step keeps a card near the same width (about 250px), so a wider screen
 * gets more notes rather than bigger ones. The breakpoints past `2xl` are
 * defined in styles.css.
 */
export const GRID_COLUMNS =
  "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 4xl:grid-cols-7 5xl:grid-cols-8 6xl:grid-cols-9 7xl:grid-cols-10";
