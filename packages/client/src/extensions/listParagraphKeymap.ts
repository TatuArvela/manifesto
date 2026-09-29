import { keymap } from "@milkdown/kit/prose/keymap";
import type { Command, Plugin } from "@milkdown/kit/prose/state";
import { isListNode } from "./taskListStructure.js";

// Delete and Backspace next to a list: remove an empty paragraph beside it
// rather than letting the default join strip the first item of its list.

/**
 * Delete: when the cursor sits in an empty paragraph immediately followed by
 * a list, remove the paragraph without merging it into the first list item
 * (which would strip the item's task/list-ness).
 */
const deleteEmptyParagraphBeforeList: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const paragraph = $from.parent;
  if (paragraph.type.name !== "paragraph") return false;
  if (paragraph.content.size > 0) return false;
  const paraDepth = $from.depth;
  if (paraDepth === 0) return false;
  const container = $from.node(paraDepth - 1);
  const paraIndex = $from.index(paraDepth - 1);
  if (paraIndex + 1 >= container.childCount) return false;
  const next = container.child(paraIndex + 1);
  if (!isListNode(next)) return false;
  if (dispatch) {
    const tr = state.tr.delete($from.before(paraDepth), $from.after(paraDepth));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/**
 * Backspace: when the cursor is at the very start of the first item of a
 * list, and the list is preceded by an empty paragraph, remove that
 * paragraph instead of letting the default lift/join strip the list item.
 */
const backspaceEmptyParagraphBeforeList: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  if ($from.parentOffset !== 0) return false;

  let outerListDepth = -1;
  for (let d = 1; d <= $from.depth; d++) {
    if (isListNode($from.node(d))) {
      outerListDepth = d;
      break;
    }
  }
  if (outerListDepth < 0) return false;

  for (let d = outerListDepth; d < $from.depth; d++) {
    if ($from.index(d) !== 0) return false;
  }

  const listStart = $from.before(outerListDepth);
  if (listStart === 0) return false;
  const $list = state.doc.resolve(listStart);
  const listIndex = $list.index();
  if (listIndex === 0) return false;
  const prev = $list.parent.child(listIndex - 1);
  if (prev.type.name !== "paragraph") return false;
  if (prev.content.size > 0) return false;

  if (dispatch) {
    const prevStart = listStart - prev.nodeSize;
    const tr = state.tr.delete(prevStart, listStart);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

export const emptyParagraphAroundListKeymap: Plugin = keymap({
  Delete: deleteEmptyParagraphBeforeList,
  Backspace: backspaceEmptyParagraphBeforeList,
});
