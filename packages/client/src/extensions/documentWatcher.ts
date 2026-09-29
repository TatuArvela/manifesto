import { prosePluginsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { Plugin } from "@milkdown/kit/prose/state";

/**
 * Calls `onChange` after every transaction that changes the document, whatever
 * its origin, including the ones the markdown listener ignores.
 */
export function documentWatcher(onChange: () => void): MilkdownPlugin {
  return (ctx) => () => {
    ctx.update(prosePluginsCtx, (plugins) => [
      ...plugins,
      new Plugin({
        view: () => ({
          update: (view, prevState) => {
            if (view.state.doc !== prevState.doc) onChange();
          },
        }),
      }),
    ]);
  };
}
