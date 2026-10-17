import type { ResolvedPos } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";

/**
 * The selection without its edges that only touch a line: dragged to the
 * end of a line, a selection reaches the start of the next one, and dragged
 * up from below it can start at the end of the line above, while selecting
 * nothing of either. Ends at the first and last text the selection covers,
 * counting an empty line it spans, or is the selection itself when it covers
 * no text (a caret).
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
