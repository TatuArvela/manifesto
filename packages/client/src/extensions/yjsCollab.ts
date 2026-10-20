import { prosePluginsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { editorHistoryPlugins } from "./editorHistory.ts";

/**
 * The name of the shared `Y.XmlFragment` to which the editor binds. Exported
 * because `MilkdownEditor` must look at the same fragment to decide if it is
 * empty. A check of a different fragment would fill a document that already has
 * content, or make blank a document that does not.
 */
export const DEFAULT_FRAGMENT_NAME = "prosemirror";

export interface YjsCollabOptions {
  ydoc: Y.Doc;
  fragmentName?: string;
  awareness?: Awareness | undefined;
}

export type YjsCollabFactory = (options: YjsCollabOptions) => MilkdownPlugin;

/**
 * `y-prosemirror` brings the Yjs runtime behind it. Thus, the code gets it on
 * demand, and does not import it at module scope. Open mode is the default
 * build, and never binds an editor to a shared document.
 *
 * It must be *loaded* before the editor is built, and not awaited inside the
 * plugin. That is the reason for a load in two steps. The runner of a Milkdown
 * plugin can await, but Milkdown reads `prosePluginsCtx` to construct the view
 * in the same pass. Thus, if a runner awaits something before it calls
 * `ctx.update`, its plugins arrive after the view exists. Then there is no
 * `ySyncPlugin`, the editor shows the local note in place of the shared
 * document, and (when it saves) that local copy is written over the copies of
 * all other persons. The tests of the collaborative binding fail exactly in
 * that way if this code goes back into the runner.
 *
 * The promise is memoized. Thus, each note after the first in a session gets
 * the module without a second fetch.
 */
let modulePromise: Promise<YjsCollabFactory> | null = null;

export function loadYjsCollab(): Promise<YjsCollabFactory> {
  if (!modulePromise) {
    modulePromise = import("y-prosemirror").then(
      ({ redoCommand, undoCommand, yCursorPlugin, ySyncPlugin, yUndoPlugin }) =>
        ({ ydoc, fragmentName = DEFAULT_FRAGMENT_NAME, awareness }) =>
        (ctx) =>
        async () => {
          const fragment = ydoc.getXmlFragment(fragmentName);
          ctx.update(prosePluginsCtx, (plugins) => {
            // The yUndoPlugin of y-prosemirror replaces the standard history
            // plugin. If you use both, an undo applies two times on remote
            // operations. It brings no keys of its own, and the toolbar finds
            // it through `editorHistory`. Thus, it comes with both.
            const next = [
              ...plugins,
              ySyncPlugin(fragment),
              yUndoPlugin(),
              ...editorHistoryPlugins({
                undo: undoCommand,
                redo: redoCommand,
              }),
            ];
            if (awareness) next.push(yCursorPlugin(awareness));
            return next;
          });
        },
    );
    // A failed fetch must not break each later attempt with a rejected promise.
    // Drop it, so that the next note tries again.
    modulePromise.catch(() => {
      modulePromise = null;
    });
  }
  return modulePromise;
}
