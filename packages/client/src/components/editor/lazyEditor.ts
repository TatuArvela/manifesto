import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

type EditorChunk = typeof import("./editorChunk.ts");

/**
 * The editor, loaded separately from the board. It is the largest part of the
 * app, and the board shows each card without it. `App` asks for it after the
 * board shows. Thus, when a note opens, it is almost always here. There is one
 * copy for all cards and the new-note sheet. Thus, the first that loads it
 * makes it ready for all of them.
 */
const editorChunk = signal<EditorChunk | null>(null);

let loading: Promise<boolean> | null = null;

/**
 * Loads the editor if it is not here yet. Resolves false when the load failed.
 * The next call tries again.
 */
export function loadEditor(): Promise<boolean> {
  if (editorChunk.value) return Promise.resolve(true);
  loading ??= import("./editorChunk.ts").then(
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
 * The editor, or null while it is still on its way. It asks for it while
 * `wanted`, and calls `onFail` if it cannot load. Thus, the code that asked can
 * stop, and does not wait for an editor that will not come.
 *
 * A panel that grows out of a card measures itself with the editor inside.
 * Thus, the code that opens one waits until this is not null.
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
