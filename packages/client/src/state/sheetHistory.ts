/**
 * The back of the browser (the back button of Android, the edge swipe in a
 * Safari tab) closes the newest sheet, as it would close a screen in an app. It
 * does not leave the view under it.
 *
 * Each sheet that opens pushes a history entry at the same address, marked as
 * its own. A back navigation pops that entry, and the sheet whose entry it was
 * closes. A sheet closed in a different way (its back arrow, Escape, Done)
 * removes its entry again with `history.back()`. Thus, there is never a dead
 * entry left where the next back press would do nothing.
 *
 * A sheet can refuse to close (a sheet that asks before it discards work) when
 * its `close` returns `false`. Its entry is then put back immediately. Thus,
 * the next back press still belongs to the sheet, not to the sheet under it.
 *
 * `history.back()` is asynchronous, and anything pushed before its `popstate`
 * arrives would be the entry from which it goes back. Thus, a sheet opened in
 * that gap (a reminder that opens a different note over the note that closes)
 * waits for it. The router delays its own pushes in the same way through
 * `afterHistorySettles`.
 *
 * Sheets reach this through `useBackToClose`.
 */

const MARK = "manifestoSheet";

interface Layer {
  id: number;
  /** Returns `false` when the sheet stays open. */
  close: () => unknown;
  /** If the entry for this layer is in the history now. */
  pushed: boolean;
}

const layers: Layer[] = [];
let nextId = 1;
/** Pops that are still to come from our own `history.back()` calls. */
let ownPops = 0;
let waiting: (() => void)[] = [];

function isOwnEntry(state: unknown, id: number): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as Record<string, unknown>)[MARK] === id
  );
}

function push(layer: Layer) {
  history.pushState({ [MARK]: layer.id }, "");
  layer.pushed = true;
}

/** Runs `fn` now, or after each of our `history.back()` calls arrived. */
export function afterHistorySettles(fn: () => void): void {
  if (ownPops === 0) fn();
  else waiting.push(fn);
}

function onPopState() {
  if (ownPops > 0) {
    ownPops--;
    if (ownPops === 0) {
      const run = waiting;
      waiting = [];
      for (const fn of run) fn();
      if (layers.length === 0)
        window.removeEventListener("popstate", onPopState);
    }
    return;
  }
  // Back from the entry of the newest sheet: that sheet closes. Its entry is
  // already gone. Thus, the cleanup that follows has nothing to remove.
  const top = layers[layers.length - 1];
  if (top?.pushed && !isOwnEntry(history.state, top.id)) {
    top.pushed = false;
    if (top.close() === false && layers.includes(top)) push(top);
  }
}

function register(layer: Layer) {
  // A listener that is already there cannot be added again, which covers a
  // sheet opened while the `history.back()` of the last sheet is still on its
  // way.
  window.addEventListener("popstate", onPopState);
  layers.push(layer);
  afterHistorySettles(() => {
    if (layers.includes(layer)) push(layer);
  });
}

function unregister(layer: Layer) {
  const index = layers.indexOf(layer);
  if (index !== -1) layers.splice(index, 1);
  // Only when its entry is the entry that shows. If something was pushed over
  // it since then (nothing does that while a sheet is open), it must not be
  // undone in its place.
  if (layer.pushed && isOwnEntry(history.state, layer.id)) {
    ownPops++;
    history.back();
  }
  layer.pushed = false;
  if (layers.length === 0 && ownPops === 0)
    window.removeEventListener("popstate", onPopState);
}

/**
 * Pushes a history entry for a sheet that just opened, and makes back call
 * `close` while that entry is there. A `close` that returns `false` kept the
 * sheet open, and keeps its entry. Returns the cleanup that removes the entry
 * again when the sheet closes in a different way.
 */
export function openHistoryLayer(close: () => unknown): () => void {
  const layer: Layer = { id: nextId++, close, pushed: false };
  register(layer);
  return () => unregister(layer);
}
