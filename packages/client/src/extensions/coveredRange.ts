import type { ResolvedPos } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";

/**
 * The selection without its edges that only touch a line. A selection dragged
 * to the end of a line reaches the start of the next line. A selection dragged
 * up from below can start at the end of the line above. Neither selects
 * anything of those lines. It ends at the first and last text that the
 * selection covers, and counts an empty line that it spans. It is the selection
 * itself when it covers no text (a caret).
 */
export function coveredRange(state: EditorState): {
  $from: ResolvedPos;
  $to: ResolvedPos;
} {
  const { from, to, empty, $from, $to } = state.selection;
  if (empty) return { $from, $to };
  let first = -1;
  let last = -1;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const start = pos + 1;
    const end = start + node.content.size;
    const covers =
      Math.min(to, end) > Math.max(from, start) ||
      (node.content.size === 0 && from < start && to > end);
    if (covers) {
      if (first === -1) first = Math.max(from, start);
      last = Math.min(to, end);
    }
    return false;
  });
  if (first === -1) return { $from, $to };
  return { $from: state.doc.resolve(first), $to: state.doc.resolve(last) };
}
