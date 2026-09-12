import { prosePluginsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

/**
 * Name of the shared `Y.XmlFragment` the editor binds to. Exported because
 * `MilkdownEditor` has to look at the same fragment to decide whether it is
 * empty, since checking a different one would seed a document that already has
 * content, or blank one that does not.
 */
export const DEFAULT_FRAGMENT_NAME = "prosemirror";

export interface YjsCollabOptions {
  ydoc: Y.Doc;
  fragmentName?: string;
  awareness?: Awareness;
}

export type YjsCollabFactory = (options: YjsCollabOptions) => MilkdownPlugin;

/**
 * `y-prosemirror` pulls the Yjs runtime in behind it, so it is fetched on
 * demand rather than imported at module scope: open mode is the default build
 * and never binds an editor to a shared document.
 *
 * It has to be *loaded* before the editor is built rather than awaited inside
 * the plugin, which is the whole reason this is a two-step load. A Milkdown
 * plugin's runner may await, but Milkdown reads `prosePluginsCtx` to construct
 * the view in the same pass, so a runner that awaits anything before calling
 * `ctx.update` has its plugins arrive after the view exists: no `ySyncPlugin`,
 * an editor showing the local note instead of the shared document, and (once
 * it saves) that local copy written over everyone else's. The collaborative
 * binding tests fail exactly that way if this is inlined back into the runner.
 *
 * The promise is memoized, so every note after the first in a session gets the
 * module without a second fetch.
 */
let modulePromise: Promise<YjsCollabFactory> | null = null;

export function loadYjsCollab(): Promise<YjsCollabFactory> {
  if (!modulePromise) {
    modulePromise = import("y-prosemirror").then(
      ({ yCursorPlugin, ySyncPlugin, yUndoPlugin }) =>
        ({ ydoc, fragmentName = DEFAULT_FRAGMENT_NAME, awareness }) =>
        (ctx) =>
        async () => {
          const fragment = ydoc.getXmlFragment(fragmentName);
          ctx.update(prosePluginsCtx, (plugins) => {
            // y-prosemirror's yUndoPlugin replaces the standard history
            // plugin; mixing the two double-applies undo on remote
            // operations.
            const next = [...plugins, ySyncPlugin(fragment), yUndoPlugin()];
            if (awareness) next.push(yCursorPlugin(awareness));
            return next;
          });
        },
    );
    // A failed fetch must not poison every later attempt with a rejected
    // promise: drop it so the next note tries again.
    modulePromise.catch(() => {
      modulePromise = null;
    });
  }
  return modulePromise;
}
