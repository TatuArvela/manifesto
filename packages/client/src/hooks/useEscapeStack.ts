import { useLayoutEffect, useRef } from "preact/hooks";

/**
 * One document-level Escape listener, dispatching to the most recently
 * registered handler and to no other.
 *
 * Every layer that closes on Escape used to bind its own listener, so one key
 * press reached all of them at once: Escape with the colour picker open both
 * dismissed the picker and closed the editor underneath it. The guards that
 * patched around that (`hasOpenAutoPopover`, `hasOpenCardPopover`) only
 * worked for the layers that remembered to ask, and could not express "the
 * version panel sits above the editor" at all, since both of those are ours.
 *
 * The layer that became active last owns the key. That is the order things
 * appear on screen, because each layer is opened by an action on the one below
 * it: a click opens the picker over the editor, in its own render. `active`
 * is what moves a layer that stays mounted (the settings panel, a dropdown)
 * in and out of the stack.
 *
 * The one arrangement this cannot order is a layer that becomes active in the
 * *same* render as one it sits inside: Preact runs a child's effects before
 * its parent's, so the ancestor would register last and end up on top. Nothing
 * opens that way (a layer is always opened by an interaction with the one
 * below), and `useLayoutEffect` at least keeps registration synchronous with
 * the commit, so a press in the same frame as an opening modal reaches it.
 */

interface Entry {
  run: () => void;
}

const stack: Entry[] = [];

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  stack[stack.length - 1]?.run();
}

function register(entry: Entry) {
  if (stack.length === 0) document.addEventListener("keydown", onKeyDown);
  stack.push(entry);
}

function unregister(entry: Entry) {
  const index = stack.lastIndexOf(entry);
  if (index !== -1) stack.splice(index, 1);
  if (stack.length === 0) document.removeEventListener("keydown", onKeyDown);
}

export function useEscapeStack(active: boolean, onEscape: () => void): void {
  const handler = useRef(onEscape);
  handler.current = onEscape;

  useLayoutEffect(() => {
    if (!active) return;
    // Called through the ref: a handler that closes over state has a new
    // identity every render, and re-registering it would jump the queue.
    const entry: Entry = { run: () => handler.current() };
    register(entry);
    return () => unregister(entry);
  }, [active]);
}

/** Test seam: the stack is module state and outlives an unmounted component. */
export function escapeStackDepth(): number {
  return stack.length;
}
