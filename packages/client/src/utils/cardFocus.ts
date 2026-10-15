/**
 * Keyboard focus among the cards on the board, for the `j` / `k` shortcuts.
 * Cards are found in the DOM rather than in the note list, because what the
 * reader moves through is what is on screen: the filtered, sorted, pinned-first
 * grid, in its reading order. A card's focus target is its open button,
 * `[data-card-open]`, which only a card that can be activated has.
 */

const CARD = "[data-note-card] [data-card-open]";

function visibleCards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(CARD)].filter(
    (card) =>
      !card.closest('[data-leaving="true"]') && card.getClientRects().length,
  );
}

function focusedCard(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof Element)) return null;
  return (
    active
      .closest("[data-note-card]")
      ?.querySelector<HTMLElement>("[data-card-open]") ?? null
  );
}

/** The note whose card holds keyboard focus, or null. */
export function focusedNoteId(): string | null {
  return (
    focusedCard()?.closest<HTMLElement>("[data-note-id]")?.dataset.noteId ??
    null
  );
}

/**
 * Moves focus `delta` cards along. With no card focused, either direction
 * starts at the first card, which is where a reader expects to begin.
 */
export function moveCardFocus(delta: number): void {
  const cards = visibleCards();
  if (cards.length === 0) return;
  const current = focusedCard();
  const index = current ? cards.indexOf(current) : -1;
  const next =
    index === -1
      ? cards[0]
      : cards[Math.min(cards.length - 1, Math.max(0, index + delta))];
  if (!next) return;
  next.focus();
  next.scrollIntoView({ block: "nearest" });
}

/**
 * The card to move focus to once the focused one leaves the board (archived,
 * trashed): the next one, or the previous one at the end.
 */
export function cardAfterFocused(): HTMLElement | null {
  const cards = visibleCards();
  const current = focusedCard();
  const index = current ? cards.indexOf(current) : -1;
  if (index === -1) return null;
  return cards[index + 1] ?? cards[index - 1] ?? null;
}
