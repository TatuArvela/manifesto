// The surface for all elements that are directly on the board, not on a note:
// the message of the empty board, the Auto-notes introduction, the search
// filters, the admin view. It is opaque and has a border. Thus, it stays
// legible over a board picture or a busy texture. On a translucent surface, a
// dark board made grey text go below 4.5:1 (`colors.test.ts`). One class, so
// that the four stay the same.
export const boardCard =
  "rounded-2xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-sm";

// A section heading on the board ("Pinned", "Others"), on a pill in the own
// color of the page. Nothing else is between it and the board behind it. On the
// plain board, the pill does not show.
export const boardLabel =
  "inline-block rounded-full px-2 py-0.5 bg-(--board-page) text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400";
