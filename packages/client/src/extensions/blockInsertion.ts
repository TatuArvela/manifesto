import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  type EditorState,
  Selection,
  TextSelection,
  type Transaction,
} from "@milkdown/kit/prose/state";

// Puts a full block (a divider, a table) into the rich editor from the toolbar.
// The raw-mode equivalent is `utils/rawBlockFormatting.ts`.

/**
 * Puts `block` into the document at the top level, after the block that
 * contains the selection, or in its place when that is an empty paragraph.
 *
 * Never at the caret itself. A divider in the middle of a sentence splits the
 * paragraph in two, and a table inside a list item has no Markdown that reads
 * back as the same thing. With `caretInside`, the caret goes to the first text
 * position of the block (the first cell of a table). Otherwise, it goes to the
 * text that follows it. When nothing follows, the code adds an empty paragraph.
 * Thus, the caret always has a place to go after the new block.
 */
export function insertBlock(
  state: EditorState,
  block: ProseNode,
  caretInside: boolean,
): Transaction | null {
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return null;
  const { $from, $to } = state.selection;

  let from: number;
  let to: number;
  if ($from.depth === 0 || $to.depth === 0) {
    // A selected node or a gap cursor is already between top-level blocks.
    from = to = state.selection.to;
  } else {
    const current = $from.node(1);
    const start = $from.before(1);
    const replacesCurrent =
      current.type === paragraph &&
      current.content.size === 0 &&
      $to.before(1) === start;
    from = replacesCurrent ? start : $to.after(1);
    to = replacesCurrent ? $from.after(1) : from;
  }

  const tr = state.tr.replaceWith(from, to, block);
  const after = from + block.nodeSize;
  if (!tr.doc.resolve(after).nodeAfter) {
    tr.insert(after, paragraph.create());
  }
  const selection = caretInside
    ? Selection.findFrom(tr.doc.resolve(from), 1, true)
    : Selection.findFrom(tr.doc.resolve(after), 1, true);
  tr.setSelection(selection ?? TextSelection.near(tr.doc.resolve(after)));
  return tr.scrollIntoView();
}
