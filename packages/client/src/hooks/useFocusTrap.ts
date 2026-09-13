import { useLayoutEffect, useRef } from "preact/hooks";

/**
 * Keeps Tab inside a modal and gives focus back when it closes.
 *
 * `aria-modal="true"` tells a screen reader that the rest of the page is
 * inert, but it does nothing to the tab order: without this, Tab walks out of
 * the note editor and through the grid behind it, where the cards are still
 * clickable and the browser still scrolls to whatever it lands on.
 *
 * Focus is only moved *in* if it isn't already there. The note editor focuses
 * its own content as it mounts, and stealing that would put the caret in the
 * title field of every note opened.
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function isVisible(el: HTMLElement): boolean {
  // `checkVisibility` covers `display:none`, `visibility:hidden` and
  // `content-visibility`, which is what a collapsed panel in a modal uses.
  return el.checkVisibility({
    checkOpacity: false,
    checkVisibilityCSS: true,
  });
}

/**
 * Tabbable elements, in tab order, across the modal *and* any popover panel
 * portalled out of it. `CardPopover` renders into `document.body`, so a
 * reminder picker opened from inside the editor is not a descendant of the
 * modal, and scoping to the container alone would make its controls unreachable
 * by keyboard, which is the opposite of the point.
 */
function tabbable(container: HTMLElement): HTMLElement[] {
  const roots: HTMLElement[] = [
    container,
    ...document.querySelectorAll<HTMLElement>(".card-popover"),
  ];
  const seen = new Set<HTMLElement>();
  for (const root of roots) {
    for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      if (!seen.has(el) && isVisible(el)) seen.add(el);
    }
  }
  return [...seen];
}

/** Stand-ins focused by `holdFocus`, each with what had focus before it. */
const standIns = new WeakMap<Element, Element | null>();

/**
 * Focuses `standIn` on behalf of a modal that doesn't exist yet, and remembers
 * what had focus before it.
 *
 * iOS opens the soft keyboard only for a focus made inside the tap itself, and
 * the note editor focuses its content well after that, once Milkdown has built.
 * `NoteInput` bridges the gap with a hidden input. The trap has to treat that
 * input as the modal's own: moving focus off it onto the first button drops the
 * keyboard, and giving focus back to it on close raises the keyboard again over
 * a page with nothing to type into. So a trap that opens over a stand-in leaves
 * focus where it is, and on close returns it to what had it before.
 */
export function holdFocus(standIn: HTMLElement | null) {
  if (!standIn) return;
  standIns.set(standIn, document.activeElement);
  standIn.focus();
}

function holdsFocus(container: HTMLElement): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  return container.contains(active) || active.closest(".card-popover") !== null;
}

export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);

  // Layout, not effect: Preact defers `useEffect` past a frame, and moving
  // focus after the modal has painted is a visible jump.
  useLayoutEffect(() => {
    const container = ref.current;
    if (!active || !container) return;

    const focused = document.activeElement;
    const standingIn = focused !== null && standIns.has(focused);
    const restoreTo = standingIn ? standIns.get(focused) : focused;
    if (!standingIn && !holdsFocus(container)) tabbable(container)[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const stops = tabbable(container);
      if (stops.length === 0) {
        event.preventDefault();
        return;
      }
      const first = stops[0];
      const last = stops[stops.length - 1];
      // Focus outside the modal at all (a click on the page behind, or a
      // browser-restored position) comes back to the near end rather than
      // being left to wander.
      if (!holdsFocus(container)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      // Only the two ends are intercepted, so Tab keeps its meaning
      // everywhere else; inside ProseMirror it still indents a list item.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Capture, so the trap sees Tab before an editor that would consume it.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Only if it is still on the page: the element that opened a note can be
      // a card that archiving has just removed from the grid.
      if (restoreTo instanceof HTMLElement && restoreTo.isConnected) {
        restoreTo.focus();
      }
    };
  }, [active]);

  return ref;
}
