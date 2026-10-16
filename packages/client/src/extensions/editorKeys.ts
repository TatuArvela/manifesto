import { prosePluginsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { headingKeymap, listItemKeymap } from "@milkdown/kit/preset/commonmark";
import { setBlockType } from "@milkdown/kit/prose/commands";
import { keymap } from "@milkdown/kit/prose/keymap";
import type { Command } from "@milkdown/kit/prose/state";

// Where the presets' own key bindings do the wrong thing, and what does the
// right one instead.

/**
 * Rebinds the presets' keys. Called from the editor's `config`, which runs
 * before the presets read their bindings.
 *
 * Both presets bind a Backspace command to Delete as well, so Delete with
 * the caret at the start of a list item or a heading did what Backspace
 * does: it joined the item into the one above, or turned an H2 into an H1,
 * where it should have deleted the next character. Delete is taken off both.
 *
 * The heading one goes altogether: {@link backspaceToParagraph} does
 * Backspace's part instead.
 */
export function configureEditorKeys(ctx: Ctx): void {
  ctx.update(listItemKeymap.key, (keys) => ({
    ...keys,
    LiftFirstListItem: { ...keys.LiftFirstListItem, shortcuts: "Backspace" },
  }));
  ctx.update(headingKeymap.key, (keys) => ({
    ...keys,
    DowngradeHeading: { ...keys.DowngradeHeading, shortcuts: [] },
  }));
}

/**
 * Backspace at the start of a heading or a code block turns it into a
 * paragraph, in one press.
 *
 * The preset stepped a heading down a level instead, so an H3 grew into an
 * H2 and then an H1 before it let go, and a code block had nothing at all:
 * at the start of the note, with no block above to join, an empty one could
 * not be got rid of from the keyboard.
 */
const backspaceToParagraph: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0) return false;
  const { heading, code_block, paragraph } = state.schema.nodes;
  const type = $from.parent.type;
  if (!paragraph || (type !== heading && type !== code_block)) return false;
  return setBlockType(paragraph)(state, dispatch);
};

/**
 * The keys handled here rather than by a preset. A plugin's keymap runs
 * ahead of every preset's, which Milkdown adds after `prosePluginsCtx`.
 */
export const editorKeys: MilkdownPlugin = (ctx) => () => {
  ctx.update(prosePluginsCtx, (plugins) => [
    ...plugins,
    keymap({ Backspace: backspaceToParagraph }),
  ]);
};
