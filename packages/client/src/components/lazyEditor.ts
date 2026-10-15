import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

type EditorChunk = typeof import("./editorChunk.js");

/**
 * The editor, fetched apart from the board: it is the largest thing in the
 * app, and the board shows every card without it. `App` asks for it once the
 * board is up, so by the time a note is opened it is almost always here.
 * One copy for every card and the new-note sheet, so that the first to fetch
 * it makes it ready for all of them.
 */
const editorChunk = signal<EditorChunk | null>(null);

let loading: Promise<boolean> | null = null;

/**
 * Fetches the editor if it is not here yet. Resolves false when the fetch
 * failed, and the next call tries again.
 */
export function loadEditor(): Promise<boolean> {
  if (editorChunk.value) return Promise.resolve(true);
  loading ??= import("./editorChunk.js").then(
    (chunk) => {
      editorChunk.value = chunk;
      return true;
    },
    () => {
      loading = null;
      return false;
    },
  );
  return loading;
}

/**
 * The editor, or null while it is still on its way. Asks for it while
 * `wanted`, and calls `onFail` if it cannot be had, so that what asked can
 * stand down rather than wait for an editor that is not coming.
 *
 * A panel that grows out of a card measures itself with the editor inside,
 * so whatever opens one holds it back until this is not null.
 */
export function useEditor(
  wanted: boolean,
  onFail: () => void,
): EditorChunk | null {
  const chunk = editorChunk.value;
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;

  useEffect(() => {
    if (!wanted || chunk) return;
    let live = true;
    void loadEditor().then((ok) => {
      if (!ok && live) onFailRef.current();
    });
    return () => {
      live = false;
    };
  }, [wanted, chunk]);

  return chunk;
}
