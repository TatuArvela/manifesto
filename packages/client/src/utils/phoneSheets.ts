/**
 * The phone's full-screen sheets (an open note, the composer, a note's history)
 * are laid out in the page rather than fixed over it, so that the page itself
 * is what scrolls.
 *
 * That is the one arrangement iOS handles the on-screen keyboard well in. A
 * `fixed` sheet with its own scroller leaves the page nothing to scroll, so to
 * keep the caret in view Safari slides the whole visible area up over the
 * sheet instead, taking its top bar off the screen, and a drag with the
 * keyboard up moves the sheet rather than the text. A sheet in the page's flow
 * gets scrolled like any page, and the board, fixed underneath while it is up,
 * keeps its own scroll position for when it comes back.
 *
 * Only the newest sheet is in the flow. One opened over another (a note's
 * history over the note) pins the one below it in place, and gives it back
 * the scroll position it had when it comes back to the top.
 *
 * The page carries `sheet-open` on <html> meanwhile, and each sheet a
 * `data-sheet` of `flow` or `covered`; styles.css applies them below the `sm`
 * breakpoint only, so a wider screen's centred dialog never notices.
 */

/** The breakpoint below which a note opens as a sheet, Tailwind's `max-sm`. */
const PHONE_QUERY = "(width < 40rem)";

/** Whether the note editor is laid out as a phone's full-screen sheet. */
export function isPhoneLayout(): boolean {
  return typeof matchMedia === "function" && matchMedia(PHONE_QUERY).matches;
}

interface Sheet {
  el: HTMLElement;
  /** The page's scroll position when another sheet covered this one. */
  scrollY: number;
}

const sheets: Sheet[] = [];

/**
 * Puts `el` in the page's flow over everything under it. Returns the call
 * that takes it out again, which the sheet makes as it unmounts.
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
 * Gives the page's own background the colour of the note in `sheet`, as
 * `--sheet-canvas` on <html>, and keeps it in step while the note is open.
 *
 * With the keyboard up in a Safari tab, iOS lets the page be panned down past
 * the foot of everything it lays out, even a `fixed` layer covering the
 * screen, and what shows there is the page's background: the board's dark
 * colour, as a band between the note's controls and the keys. Only the
 * background reaches it, so it takes the note's colour.
 *
 * Followed through the note's class, which is what a colour change alters,
 * and again once its colour transition has run, since the class changes at
 * its start. Version history swaps one article for another, so the panel's
 * children are watched for a new one.
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
  // The element the note is drawn in, which `NoteSheet` marks: it is not the
  // sheet's own child, since what sits beside it on a wide screen shares a row.
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

/** Test seam: the stack is module state and outlives an unmounted sheet. */
export function openSheetCount(): number {
  return sheets.length;
}
