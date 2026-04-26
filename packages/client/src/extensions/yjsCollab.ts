import { prosePluginsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { ySyncPlugin, yUndoPlugin } from "y-prosemirror";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

export interface YjsCollabOptions {
  ydoc: Y.Doc;
  fragmentName?: string;
  awareness?: Awareness;
}

/**
 * Milkdown plugin that wires the editor's ProseMirror state to a shared Y.Doc
 * via y-prosemirror. Replaces the default `history` plugin — `yUndoPlugin`
 * is the collaboration-aware undo stack.
 */
export const yjsCollab =
  ({ ydoc, fragmentName = "prosemirror" }: YjsCollabOptions): MilkdownPlugin =>
  (ctx) => {
    return async () => {
      const fragment = ydoc.getXmlFragment(fragmentName);
      ctx.update(prosePluginsCtx, (plugins) => [
        ...plugins,
        ySyncPlugin(fragment),
        yUndoPlugin(),
      ]);
    };
  };
