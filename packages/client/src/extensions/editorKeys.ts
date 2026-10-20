import { prosePluginsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { headingKeymap, listItemKeymap } from "@milkdown/kit/preset/commonmark";
import { setBlockType } from "@milkdown/kit/prose/commands";
import { keymap } from "@milkdown/kit/prose/keymap";
import { liftListItem, sinkListItem } from "@milkdown/kit/prose/schema-list";
import { type Command, TextSelection } from "@milkdown/kit/prose/state";
import { goToNextCell, isInTable } from "@milkdown/kit/prose/tables";
import { addBodyRowAfter } from "./tableActions.ts";

// Where the own key bindings of the presets do the wrong thing, and what does
// the correct thing in their place.

/**
 * Binds the keys of the presets again. Called from the `config` of the editor,
 * which runs before the presets read their bindings.
 *
 * Both presets also bind a Backspace command to Delete. Thus, Delete with the
 * caret at the start of a list item or a heading did what Backspace does. It
 * joined the item into the item above, or changed an H2 into an H1, where it
 * should have deleted the next character. Delete is removed from both.
 *
 * The heading binding goes fully. {@link backspaceToParagraph} does the part of
 * Backspace in its place.
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
 * Backspace at the start of a heading or a code block changes it into a
 * paragraph, with one press.
 *
 * The preset moved a heading down one level in place of that. Thus, an H3
 * became an H2, and then an H1, before it went. A code block had nothing. At
 * the start of the note, with no block above to join, you could not remove an
 * empty code block from the keyboard.
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
 * act: an indent of the first item of a list, Tab in the last cell of a table,
 * Shift-Tab in its first cell. A declined Tab goes back to the browser, which
 * moved focus out of the note to the next button. Thus, the next keystroke
 * typed nowhere. Tab in the last cell of a table adds a row, as in a
 * spreadsheet.
 *
 * In other places, Tab stays with the browser. Thus, the keyboard can still
 * leave the text.
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
 * An arrow off the far side of a code block that starts or ends the note adds a
 * paragraph there, and moves into it.
 *
 * Above and below a table or a divider at either end, the gap cursor gives the
 * caret a place, and typing there makes the paragraph. The gap cursor does not
 * show next to a code block, because the caret can already be in its text.
 * Thus, there was no way past one from the keyboard: Enter only adds a line
 * inside it.
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
 * The keys handled here, not by a preset. The keymap of a plugin runs before
 * that of each preset, which Milkdown adds after `prosePluginsCtx`.
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
