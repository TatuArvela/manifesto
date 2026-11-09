/**
 * The card drawn in the window of a morph (`utils/morph.ts`) for a part of the
 * way. The window grows out of the card with the look of the card, and changes
 * to the editor at `SWITCH_AT`. At the close, it changes back to the card at
 * the same point. Before, the window showed the editor from its first frame,
 * and the toolbar and the empty space of the editor were in the small window
 * over the card.
 *
 * The copy has two parts:
 * - **The sheet**: a shallow copy of the card. It fills the window, so it is
 *   laid out at the size of the panel and scaled with it. It draws the color,
 *   the finish and the border of the card.
 * - **The face**: a full copy of the card, laid out at the size of the card,
 *   with the inverse scale of the window (as `.note-sheet-content` has).
 *   Thus, its text keeps its size and its place. It draws only the content of
 *   the card, not a second background.
 */

/**
 * The part of the way (after the curve) at which the card and the editor change
 * places. At the same point in both directions.
 */
export const SWITCH_AT = 0.5;

/**
 * The classes of the card that only the card on the board uses: its hidden and
 * ghost states, its lean, its drag, its transitions and its shadow (the panel
 * draws the shadow of the morph).
 */
const BOARD_ONLY = [
  "note-morphed",
  "note-ghost",
  "opacity-20",
  "note-tilt",
  "note-draggable",
  "note-held",
  "note-card-transition",
  "note-shadow",
];

/** A copy of the card that nothing can reach: no ids, no focus, no events. */
function copyOf(card: HTMLElement, deep: boolean): HTMLElement {
  const copy = card.cloneNode(deep) as HTMLElement;
  copy.classList.remove(...BOARD_ONLY);
  copy.removeAttribute("draggable");
  for (const element of [copy, ...copy.querySelectorAll("[id]")]) {
    element.removeAttribute("id");
  }
  return copy;
}

/**
 * The checkboxes of a checklist. Preact sets their `checked` property, and a
 * copy of a node takes only the attribute. Thus, without this, each box of the
 * copy was empty.
 */
function copyChecks(from: HTMLElement, to: HTMLElement) {
  const sources = from.querySelectorAll("input");
  const copies = to.querySelectorAll("input");
  for (const [index, source] of sources.entries()) {
    const copy = copies[index];
    if (copy) copy.checked = source.checked;
  }
}

/** The copy of a card in the window of a panel. */
export interface StandIn {
  /** The sheet, which the caller adds to the panel and removes after. */
  element: HTMLElement;
  /** The face, which gets the inverse scale of the window. */
  face: HTMLElement;
}

/**
 * Makes the copy of `card` for a panel. The panel must be `position: relative`
 * (`NoteSheet`), because the sheet fills it.
 */
export function standInFor(card: HTMLElement): StandIn {
  const border = Number.parseFloat(getComputedStyle(card).borderTopWidth) || 0;

  const element = copyOf(card, false);
  element.setAttribute("aria-hidden", "true");
  element.inert = true;
  Object.assign(element.style, {
    position: "absolute",
    inset: "0",
    width: "auto",
    height: "auto",
    margin: "0",
    zIndex: "1",
    aspectRatio: "auto",
    // The corners of the panel, which a morph animates in the same scale.
    borderRadius: "inherit",
    boxShadow: "none",
    outline: "none",
    rotate: "none",
    transform: "none",
    pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);

  const face = copyOf(card, true);
  copyChecks(card, face);
  face.classList.add("morph-stand-in-face");
  Object.assign(face.style, {
    position: "absolute",
    // Over the border of the sheet. The face keeps a border of its own (with
    // no color), so its content is where the content of the card is.
    top: `${-border}px`,
    left: `${-border}px`,
    width: `${card.offsetWidth}px`,
    height: `${card.offsetHeight}px`,
    margin: "0",
    aspectRatio: "auto",
    background: "none",
    backdropFilter: "none",
    borderColor: "transparent",
    boxShadow: "none",
    outline: "none",
    rotate: "none",
    transformOrigin: "0 0",
  } satisfies Partial<CSSStyleDeclaration>);
  element.append(face);
  return { element, face };
}

/** An opacity that changes at once, from `from` to `to`, at `at`. */
function step(from: number, to: number, at: number): Keyframe[] {
  return [
    { opacity: from },
    { opacity: from, offset: at },
    { opacity: to, offset: at },
    { opacity: to },
  ];
}

/**
 * The keyframes that change the card and the editor at `at`: for the sheet of
 * the copy, and for the content of the panel. `cardFirst` for a grow, which
 * starts with the card. The offsets are on the progress after the curve, as
 * the keyframes of the path are. Thus, the change is at a point of the way,
 * not of the time.
 */
export function switchFrames(
  cardFirst: boolean,
  at: number,
): { standIn: Keyframe[]; content: Keyframe[] } {
  return cardFirst
    ? { standIn: step(1, 0, at), content: step(0, 1, at) }
    : { standIn: step(0, 1, at), content: step(1, 0, at) };
}
