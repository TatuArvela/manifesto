import { prosePluginsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { headingKeymap, listItemKeymap } from "@milkdown/kit/preset/commonmark";
import { setBlockType } from "@milkdown/kit/prose/commands";
import { keymap } from "@milkdown/kit/prose/keymap";
import { liftListItem, sinkListItem } from "@milkdown/kit/prose/schema-list";
import { type Command, TextSelection } from "@milkdown/kit/prose/state";
import { goToNextCell, isInTable } from "@milkdown/kit/prose/tables";
import { addBodyRowAfter } from "./tableActions.ts";

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
 * Tab and Shift-Tab in a list or a table stay in the editor.
 *
 * The presets bind them there, but their commands decline where they cannot
 * act: indenting a list's first item, Tab in a table's last cell, Shift-Tab
 * in its first. A declined Tab is the browser's again, and it moved focus
 * out of the note to the next button, so the next keystroke typed nowhere.
 * Tab in a table's last cell adds a row instead, as in a spreadsheet.
 *
 * Elsewhere Tab is left to the browser, so the keyboard can still leave the
 * text.
 */
const tabIn =
  (dir: 1 | -1): Command =>
  (state, dispatch) => {
    if (isInTable(state)) {
      if (goToNextCell(dir)(state, dispatch)) return true;
      if (dir === 1 && dispatch) addBodyRowAfter(state, dispatch);
      return true;
    }
    const item = state.schema.nodes.list_item;
    if (!item) return false;
    const { $from } = state.selection;
    let inList = false;
    for (let d = $from.depth; d > 0 && !inList; d--) {
      inList = $from.node(d).type === item;
    }
    if (!inList) return false;
    const move = dir === 1 ? sinkListItem(item) : liftListItem(item);
    move(state, dispatch);
    return true;
  };

/**
 * An arrow off the far side of a code block that starts or ends the note
 * adds a paragraph there and moves into it.
 *
 * Above and below a table or a divider at either end, the gap cursor gives
 * the caret somewhere to stand, and typing there makes the paragraph. It
 * does not stand beside a code block, whose text the caret can already be
 * in, so there was no way past one from the keyboard: Enter only adds a
 * line inside it.
 */
const leaveCodeBlock =
  (dir: "up" | "down" | "left" | "right"): Command =>
  (state, dispatch, view) => {
    const { $from, empty } = state.selection;
    const { code_block, paragraph } = state.schema.nodes;
    if (!empty || !paragraph || $from.parent.type !== code_block) return false;
    if ($from.depth !== 1 || !view?.endOfTextblock(dir)) return false;
    const forward = dir === "down" || dir === "right";
    const index = $from.index(0);
    if (forward ? index !== state.doc.childCount - 1 : index !== 0) {
      return false;
    }
    if (dispatch) {
      const pos = forward ? $from.after(1) : $from.before(1);
      const tr = state.tr.insert(pos, paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, pos + 1));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };

/**
 * The keys handled here rather than by a preset. A plugin's keymap runs
 * ahead of every preset's, which Milkdown adds after `prosePluginsCtx`.
 */
export const editorKeys: MilkdownPlugin = (ctx) => () => {
  ctx.update(prosePluginsCtx, (plugins) => [
    ...plugins,
    keymap({
      Backspace: backspaceToParagraph,
      Tab: tabIn(1),
      "Shift-Tab": tabIn(-1),
      ArrowUp: leaveCodeBlock("up"),
      ArrowDown: leaveCodeBlock("down"),
      ArrowLeft: leaveCodeBlock("left"),
      ArrowRight: leaveCodeBlock("right"),
    }),
  ]);
};
