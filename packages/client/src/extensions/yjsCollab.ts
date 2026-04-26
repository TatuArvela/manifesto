import { prosePluginsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { yCursorPlugin, ySyncPlugin, yUndoPlugin } from "y-prosemirror";
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
 * is the collaboration-aware undo stack. When `awareness` is supplied, also
 * renders remote users' cursors and selections via `yCursorPlugin`.
 */
export const yjsCollab =
  ({
    ydoc,
    fragmentName = "prosemirror",
    awareness,
  }: YjsCollabOptions): MilkdownPlugin =>
  (ctx) => {
    return async () => {
      const fragment = ydoc.getXmlFragment(fragmentName);
      ctx.update(prosePluginsCtx, (plugins) => {
        const next = [...plugins, ySyncPlugin(fragment), yUndoPlugin()];
        if (awareness) next.push(yCursorPlugin(awareness));
        return next;
      });
    };
  };
