import { useLayoutEffect, useRef } from "preact/hooks";

/**
 * Keeps Tab inside a modal, and gives focus back when it closes.
 *
 * `aria-modal="true"` tells a screen reader that the remaining page is inert,
 * but it does not change the tab order. Without this, Tab goes out of the note
 * editor and through the grid behind it, where the cards are still clickable
 * and the browser still scrolls to the element where focus goes.
 *
 * The code moves focus *in* only if it is not already there. The note editor
 * focuses its own content when it mounts. If the trap took that away, the caret
 * would be in the title field of each note that opens.
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
  // `content-visibility`, which a collapsed panel in a modal uses.
  return el.checkVisibility({
    checkOpacity: false,
    checkVisibilityCSS: true,
  });
}

/** The tabbable elements only within `root`, in tab order. */
export function tabbableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isVisible);
}

/**
 * The tabbable elements, in tab order, across the modal *and* each popover
 * panel portalled out of it. `CardPopover` renders into `document.body`. Thus,
 * a reminder picker opened from inside the editor is not a descendant of the
 * modal. If the trap applied only to the container, the keyboard could not
 * reach its controls, which is the opposite of the purpose.
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

/**
 * Stand-ins that `holdFocus` focused, each with the element that had focus
 * before it.
 */
const standIns = new WeakMap<Element, Element | null>();

/**
 * Focuses `standIn` for a modal that does not exist yet, and remembers the
 * element that had focus before it.
 *
 * iOS opens the soft keyboard only for a focus inside the tap itself, and the
 * note editor focuses its content long after that, when Milkdown completed its
 * build. `NoteInput` fills the gap with a hidden input. The trap must treat
 * that input as part of the modal. When focus moved off it onto the first
 * button, the keyboard closed. When focus went back to it on close, the
 * keyboard opened again over a page with nothing to type into. Thus, a trap
 * that opens over a stand-in keeps focus where it is, and on close returns it
 * to the element that had it before.
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

/**
 * The traps that are open, oldest first. Only the newest handles Tab. A dialog
 * portalled over the note editor (the share dialog, version history) is not
 * inside the container of the editor. The trap of the editor, which registered
 * its listener first, would otherwise see focus "outside" it, and pull it back
 * on each press.
 */
const openTraps: object[] = [];

export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);

  // Layout, not effect. Preact delays `useEffect` past one frame, and a move of
  // focus after the modal painted is a visible jump.
  useLayoutEffect(() => {
    const container = ref.current;
    if (!active || !container) return;

    const focused = document.activeElement;
    const standingIn = focused !== null && standIns.has(focused);
    const restoreTo = standingIn ? standIns.get(focused) : focused;
    if (!standingIn && !holdsFocus(container)) tabbable(container)[0]?.focus();

    const trap = {};
    openTraps.push(trap);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      if (openTraps[openTraps.length - 1] !== trap) return;
      const stops = tabbable(container);
      const first = stops[0];
      const last = stops.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      // Focus outside the modal (a click on the page behind, or a position that
      // the browser restored) comes back to the near end. It does not wander.
      if (!holdsFocus(container)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      // Only the two ends are intercepted. Thus, Tab keeps its meaning in all
      // other places. Inside ProseMirror, it still indents a list item.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Capture. Thus, the trap sees Tab before an editor that would use it.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      openTraps.splice(openTraps.indexOf(trap), 1);
      // Only if it is still on the page. The element that opened a note can be
      // a card that an archive just removed from the grid.
      if (restoreTo instanceof HTMLElement && restoreTo.isConnected) {
        restoreTo.focus();
      }
    };
  }, [active]);

  return ref;
}
