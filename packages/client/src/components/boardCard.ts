// The surface for anything that sits straight on the board rather than on a
// note: the empty board's message, the Auto-notes introduction, the search
// filters, the admin view. Opaque and bordered, so it stays legible over a
// board picture or a busy texture: a translucent one let a dark board pull
// grey text under 4.5:1 (`colors.test.ts`). One class so the four do not
// drift apart.
export const boardCard =
  "rounded-2xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-sm";

// A section heading on the board ("Pinned", "Others"), on a pill of the
// page's own colour: nothing else stands between it and whatever board is
// behind, and on the plain board the pill does not show.
export const boardLabel =
  "inline-block rounded-full px-2 py-0.5 bg-(--board-page) text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400";
