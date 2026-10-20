/**
 * The full-screen sheets of the phone (an open note, the composer, the history
 * of a note) are part of the page layout, not fixed over it. Thus, the page
 * itself scrolls.
 *
 * That is the one arrangement in which iOS handles the on-screen keyboard well.
 * A `fixed` sheet with its own scroller leaves the page nothing to scroll. To
 * keep the caret in view, Safari then slides the full visible area up over the
 * sheet, which takes its top bar off the screen. A drag with the keyboard up
 * then moves the sheet, not the text. A sheet in the flow of the page scrolls
 * as any page does. The board, fixed under it while it is open, keeps its own
 * scroll position for when it comes back.
 *
 * Only the newest sheet is in the flow. A sheet opened over a different sheet
 * (the history of a note over the note) fixes the sheet below it in place, and
 * gives it back its previous scroll position when it comes back to the top.
 *
 * In the meantime, the page has `sheet-open` on <html>, and each sheet has a
 * `data-sheet` of `flow` or `covered`. styles.css applies them only below the
 * `sm` breakpoint. Thus, the centered dialog of a wider screen never sees them.
 */

/**
 * The breakpoint below which a note opens as a sheet, the `max-sm` of Tailwind.
 */
export const PHONE_QUERY = "(width < 40rem)";

/** If the note editor has the layout of a full-screen sheet of a phone. */
export function isPhoneLayout(): boolean {
  return typeof matchMedia === "function" && matchMedia(PHONE_QUERY).matches;
}

interface Sheet {
  el: HTMLElement;
  /**
   * The scroll position of the page when a different sheet covered this one.
   */
  scrollY: number;
}

const sheets: Sheet[] = [];

/**
 * Puts `el` in the flow of the page over all content under it. Returns the call
 * that takes it out again, which the sheet makes when it unmounts.
 */
export function openSheet(el: HTMLElement): () => void {
  const below = sheets[sheets.length - 1];
  if (below) {
    below.scrollY = window.scrollY;
    below.el.dataset.sheet = "covered";
  }
  const sheet: Sheet = { el, scrollY: 0 };
  sheets.push(sheet);
  el.dataset.sheet = "flow";
  if (sheets.length === 1) document.addEventListener("focusin", keepFocusClear);
  document.documentElement.classList.add("sheet-open");
  window.scrollTo(0, 0);
  paintPage(el);
  return () => closeSheet(sheet);
}

function closeSheet(sheet: Sheet) {
  const index = sheets.indexOf(sheet);
  if (index === -1) return;
  const wasTop = index === sheets.length - 1;
  sheets.splice(index, 1);
  delete sheet.el.dataset.sheet;
  const top = sheets[sheets.length - 1];
  if (!top) {
    document.removeEventListener("focusin", keepFocusClear);
    document.documentElement.classList.remove("sheet-open");
    stopPainting?.();
    return;
  }
  if (wasTop) {
    top.el.dataset.sheet = "flow";
    window.scrollTo(0, top.scrollY);
    paintPage(top.el);
  }
}

let stopPainting: (() => void) | null = null;

/**
 * Scrolls a control that the keyboard reached out from under the sticky bars of
 * a phone sheet (`.note-sheet-top`, `.note-sheet-bottom`). The browser counts
 * these as on the screen, and thus does not scroll for them (WCAG 2.4.11). Only
 * for keyboard focus. Thus, a tap never moves the page under the finger. Never
 * for the text of the editor, whose box is the full note. iOS keeps the caret
 * in view. One frame later, after a scroll of the browser itself.
 */
function keepFocusClear(event: FocusEvent) {
  const target = event.target;
  const sheet = sheets[sheets.length - 1]?.el;
  if (
    !isPhoneLayout() ||
    !(target instanceof HTMLElement) ||
    !sheet?.contains(target) ||
    target.isContentEditable ||
    target.closest(".note-sheet-top, .note-sheet-bottom")
  ) {
    return;
  }
  requestAnimationFrame(() => {
    if (!target.matches(":focus-visible")) return;
    const box = target.getBoundingClientRect();
    const top =
      sheet.querySelector(".note-sheet-top")?.getBoundingClientRect().bottom ??
      0;
    const bottom =
      sheet.querySelector(".note-sheet-bottom")?.getBoundingClientRect().top ??
      window.innerHeight;
    if (box.height > bottom - top) return;
    if (box.top < top) window.scrollBy(0, box.top - top);
    else if (box.bottom > bottom) window.scrollBy(0, box.bottom - bottom);
  });
}

/**
 * Gives the own background of the page the color of the note in `sheet`, as
 * `--sheet-canvas` on <html>, and keeps it the same while the note is open.
 *
 * With the keyboard up in a Safari tab, iOS lets the user pan the page down
 * past the bottom of all its layout, also a `fixed` layer that covers the
 * screen. The background of the page shows there: the dark color of the board,
 * as a band between the controls of the note and the keys. Only the background
 * reaches it. Thus, it takes the color of the note.
 *
 * Followed through the class of the note, which a color change changes, and
 * again after its color transition ran, because the class changes at its start.
 * Version history replaces one article with a different one. Thus, the code
 * watches the children of the panel for a new one.
 */
function paintPage(sheet: HTMLElement) {
  stopPainting?.();
  const root = document.documentElement;
  let surface: HTMLElement | null = null;

  const copy = () => {
    if (surface)
      root.style.setProperty(
        "--sheet-canvas",
        getComputedStyle(surface).backgroundColor,
      );
  };
  const colour = new MutationObserver(copy);
  const find = () => {
    const next = sheet.querySelector<HTMLElement>(".note-sheet-surface");
    if (next !== surface) {
      colour.disconnect();
      surface = next;
      if (surface)
        colour.observe(surface, {
          attributes: true,
          attributeFilter: ["class"],
        });
    }
    copy();
  };
  const swaps = new MutationObserver(find);
  // The element in which the note is drawn, which `NoteSheet` marks. It is not
  // a direct child of the sheet, because the content next to it on a wide
  // screen shares a row.
  const panel = sheet.querySelector(".note-sheet-panel");
  if (panel) swaps.observe(panel, { childList: true });
  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target === surface) copy();
  };
  sheet.addEventListener("transitionend", onTransitionEnd);
  find();

  stopPainting = () => {
    colour.disconnect();
    swaps.disconnect();
    sheet.removeEventListener("transitionend", onTransitionEnd);
    root.style.removeProperty("--sheet-canvas");
    stopPainting = null;
  };
}

/** Test seam: the stack is module state, and stays after a sheet unmounts. */
export function openSheetCount(): number {
  return sheets.length;
}
