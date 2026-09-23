import { useLayoutEffect, useRef } from "preact/hooks";

/**
 * One document-level listener for the board's single-key shortcuts, the way
 * `useEscapeStack` is the one listener for Escape. A component binds a key
 * with `useShortcut(key, run)` and never listens itself.
 *
 * A single key is only a shortcut when nothing else wants it, so the
 * dispatcher, not each binding, decides when to stand aside:
 *
 * - while typing: focus in a text field, a select or anything editable, the
 *   note editor included;
 * - while a layer is up: any `aria-modal` dialog (the editor, Settings, a
 *   confirmation) or open popover (a dropdown, a card menu). Those own the
 *   keyboard, and `c` there must type or do nothing;
 * - with a modifier held, so the browser's and the system's own shortcuts are
 *   never taken. Shift is allowed: it is how `?` and `#` are typed.
 *
 * A key bound twice goes to the binding made last, as Escape does.
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
    // A browser without the Popover API cannot have one open.
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
