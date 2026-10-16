import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  type EditorState,
  TextSelection,
  type Transaction,
} from "@milkdown/kit/prose/state";

// The toolbar's Code block button in the rich editor. Raw mode's is
// `toggleRawCodeBlock` in `utils/rawBlockFormatting.ts`.

/** A line break inside a paragraph is a line of code, not nothing. */
const leafText = (leaf: ProseNode) =>
  leaf.type.name === "hardbreak" ? "\n" : "";

/**
 * Turns the selected blocks into one code block, a line for each paragraph,
 * or the code block the caret is in back into a paragraph for each line.
 *
 * Making a block type of each paragraph, as `setBlockType` does, gave every
 * selected line a code block of its own. The blocks taken in are the ones
 * whose nearest common container can hold a code block, so a selection across
 * list items takes in the whole list, as text. Marks do not survive, since
 * code has none.
 */
export function toggleCodeBlock(state: EditorState): Transaction | null {
  const { code_block, paragraph } = state.schema.nodes;
  if (!code_block || !paragraph) return null;
  const { $from, $to } = state.selection;

  if ($from.parent.type === code_block && $from.sameParent($to)) {
    const lines = $from.parent.textContent.split("\n");
    const paragraphs = lines.map((line) =>
      paragraph.create(null, line ? state.schema.text(line) : undefined),
    );
    const start = $from.before();
    const tr = state.tr.replaceWith(start, $from.after(), paragraphs);
    return tr
      .setSelection(TextSelection.near(tr.doc.resolve(start + 1)))
      .scrollIntoView();
  }

  const range = $from.blockRange(
    $to,
    (node) => node.type.contentMatch.matchType(code_block) !== null,
  );
  if (!range) return null;
  const text = state.doc.textBetween(range.start, range.end, "\n", leafText);
  const block = code_block.create(
    null,
    text ? state.schema.text(text) : undefined,
  );
  const tr = state.tr.replaceWith(range.start, range.end, block);
  const inside = range.start + 1;
  return tr
    .setSelection(TextSelection.create(tr.doc, inside, inside + text.length))
    .scrollIntoView();
}
