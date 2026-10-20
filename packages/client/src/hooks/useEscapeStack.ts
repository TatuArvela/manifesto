import { useLayoutEffect, useRef } from "preact/hooks";

/**
 * One Escape listener at document level. It sends each press to the handler
 * that registered most recently, and to no other.
 *
 * A listener for each layer would give one key press to all of them at the same
 * time. Thus, Escape with the color picker open would also close the editor
 * under it.
 *
 * The layer that became active last owns the key. That is the order in which
 * items show on the screen, because an action on the layer below opens each
 * layer: a click opens the picker over the editor, in its own render. `active`
 * moves a layer that stays mounted (the settings panel, a dropdown) in and out
 * of the stack.
 *
 * This cannot put one arrangement in order: a layer that becomes active in the
 * *same* render as a layer that contains it. Preact runs the effects of a child
 * before those of its parent. Thus, the ancestor would register last, and be on
 * top. Nothing opens in that way (an interaction with the layer below always
 * opens a layer). `useLayoutEffect` keeps the registration synchronous with the
 * commit. Thus, a press in the same frame as an opening modal reaches it.
 */

interface Entry {
  run: () => void;
  /** Also sends the press on to the layer below, as a tooltip does. */
  passThrough: boolean;
}

const stack: Entry[] = [];

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  // A copy. A handler can remove its own layer, or other layers, from the
  // stack.
  for (const entry of [...stack].reverse()) {
    entry.run();
    if (!entry.passThrough) return;
  }
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

/**
 * `passThrough` is for an element that is only over the page, not a layer of
 * it: a tooltip. Escape removes it, and still reaches the layer below. Thus, a
 * keyboard user in the note editor, where a focused button always shows its
 * tooltip, does not have to push Escape two times to close it.
 */
export function useEscapeStack(
  active: boolean,
  onEscape: () => void,
  { passThrough = false }: { passThrough?: boolean } = {},
): void {
  const handler = useRef(onEscape);
  handler.current = onEscape;

  useLayoutEffect(() => {
    if (!active) return;
    // Called through the ref. A handler that closes over state has a new
    // identity on each render, and a new registration would put it before the
    // others in the queue.
    const entry: Entry = { run: () => handler.current(), passThrough };
    register(entry);
    return () => unregister(entry);
  }, [active, passThrough]);
}

/**
 * Test seam: the stack is module state, and stays after a component unmounts.
 */
export function escapeStackDepth(): number {
  return stack.length;
}
