/**
 * The browser's back (Android's back button, the edge swipe in a Safari tab)
 * closes the newest sheet, as it would a screen in an app, rather than leaving
 * the view underneath it.
 *
 * Each sheet that opens pushes a history entry at the same address, marked as
 * its own. Going back pops that entry, and the sheet whose entry it was is
 * closed. A sheet closed any other way (its back arrow, Escape, Done) takes
 * its entry off again with `history.back()`, so there is never a dead entry
 * left for the next press of back to land on with nothing happening.
 *
 * `history.back()` is asynchronous, and anything pushed before its `popstate`
 * arrives would be the entry it goes back from. So a sheet opened in that gap
 * (a reminder opening another note over the one closing) waits for it, and the
 * router defers its own pushes the same way through `afterHistorySettles`.
 *
 * Sheets reach this through `useBackToClose`.
 */

const MARK = "manifestoSheet";

interface Layer {
  id: number;
  close: () => void;
  /** Whether the entry for this layer is in the history now. */
  pushed: boolean;
}

const layers: Layer[] = [];
let nextId = 1;
/** Pops still to come from our own `history.back()` calls. */
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

/** Runs `fn` now, or once every `history.back()` of ours has landed. */
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
  // Back from the newest sheet's entry: that sheet is what closes. Its entry
  // is already gone, so the cleanup that follows has nothing to take off.
  const top = layers[layers.length - 1];
  if (top?.pushed && !isOwnEntry(history.state, top.id)) {
    top.pushed = false;
    top.close();
  }
}

function register(layer: Layer) {
  // Adding a listener that is already there is a no-op, which covers a sheet
  // opened while the last one's `history.back()` is still on its way.
  window.addEventListener("popstate", onPopState);
  layers.push(layer);
  afterHistorySettles(() => {
    if (layers.includes(layer)) push(layer);
  });
}

function unregister(layer: Layer) {
  const index = layers.indexOf(layer);
  if (index !== -1) layers.splice(index, 1);
  // Only when its entry is the one showing: something pushed over it since
  // (which nothing does while a sheet is up) must not be undone instead.
  if (layer.pushed && isOwnEntry(history.state, layer.id)) {
    ownPops++;
    history.back();
  }
  layer.pushed = false;
  if (layers.length === 0 && ownPops === 0)
    window.removeEventListener("popstate", onPopState);
}

/**
 * Pushes a history entry for a sheet that has just opened, and has back call
 * `close` while that entry is there. Returns the cleanup that takes the entry
 * off again when the sheet closes some other way.
 */
export function openHistoryLayer(close: () => void): () => void {
  const layer: Layer = { id: nextId++, close, pushed: false };
  register(layer);
  return () => unregister(layer);
}
