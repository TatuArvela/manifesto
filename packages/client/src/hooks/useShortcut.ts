import { useLayoutEffect, useRef } from "preact/hooks";

/**
 * One listener at document level for the single-key shortcuts of the board, as
 * `useEscapeStack` is the one listener for Escape. A component binds a key with
 * `useShortcut(key, run)`, and never listens itself.
 *
 * A single key is a shortcut only when nothing else needs it. Thus, the
 * dispatcher, not each binding, decides when the shortcuts do not operate:
 *
 * - While you type: focus is in a text field, a select or an editable element,
 *   also the note editor.
 * - While a layer is open: an `aria-modal` dialog (the editor, Settings, a
 *   confirmation) or an open popover (a dropdown, a card menu). Those own the
 *   keyboard, and `c` there must type or do nothing.
 * - With a modifier held. Thus, the shortcuts of the browser and the system are
 *   never taken. Shift is permitted, because you use it to type `?` and `#`.
 *
 * If two bindings use the same key, the last binding gets it, as for Escape.
 */

interface Binding {
  key: string;
  run: (event: KeyboardEvent) => void;
}

const bindings: Binding[] = [];

const EDITABLE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE) !== null;
}

export function hasOpenLayer(): boolean {
  if (document.querySelector('[aria-modal="true"]')) return true;
  try {
    return document.querySelector(":popover-open") !== null;
  } catch {
    // A browser without the Popover API cannot have an open popover.
    return false;
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (isTypingTarget(event.target) || hasOpenLayer()) return;
  const binding = bindings.findLast((b) => b.key === event.key);
  if (!binding) return;
  event.preventDefault();
  binding.run(event);
}

function register(binding: Binding) {
  if (bindings.length === 0) document.addEventListener("keydown", onKeyDown);
  bindings.push(binding);
}

function unregister(binding: Binding) {
  const index = bindings.lastIndexOf(binding);
  if (index !== -1) bindings.splice(index, 1);
  if (bindings.length === 0) {
    document.removeEventListener("keydown", onKeyDown);
  }
}

export function useShortcut(
  key: string,
  run: (event: KeyboardEvent) => void,
  enabled = true,
): void {
  const handler = useRef(run);
  handler.current = run;

  useLayoutEffect(() => {
    if (!enabled) return;
    const binding: Binding = { key, run: (e) => handler.current(e) };
    register(binding);
    return () => unregister(binding);
  }, [key, enabled]);
}
