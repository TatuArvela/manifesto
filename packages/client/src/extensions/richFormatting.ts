import { type Editor, editorStateCtx, editorViewCtx } from "@milkdown/kit/core";
import {
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import type {
  MarkType,
  NodeType,
  ResolvedPos,
} from "@milkdown/kit/prose/model";
import { liftListItem, sinkListItem } from "@milkdown/kit/prose/schema-list";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { liftTarget } from "@milkdown/kit/prose/transform";
import { callCommand } from "@milkdown/kit/utils";
import type { ActiveFormats, FormatType } from "../utils/formatTypes.js";
import { insertBlock } from "./blockInsertion.js";
import { toggleCodeBlock } from "./codeBlockToggle.js";
import {
  toggleSubscriptCommand,
  toggleSuperscriptCommand,
  toggleUnderlineCommand,
} from "./manifestoInlineMarks.js";
import { insertTable } from "./tableActions.js";

// The formatting toolbar's reading and writing of the rich editor: which
// formats the selection has, and applying one. The raw-mode counterpart, for
// the markdown textarea, is `utils/rawFormatting.ts`.

export const emptyFormats: ActiveFormats = {
  heading: false,
  bold: false,
  italic: false,
  quote: false,
  code: false,
  link: false,
  numberedList: false,
  unorderedList: false,
  checklist: false,
  strikethrough: false,
  underline: false,
  subscript: false,
  superscript: false,
  table: false,
  codeBlock: false,
};

function isMarkActive(state: EditorState, mark: MarkType | undefined): boolean {
  if (!mark) return false;
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!mark.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, mark);
}

function findNodeAncestor(
  state: EditorState,
  type: NodeType | undefined,
): { depth: number; attrs: Record<string, unknown> } | null {
  if (!type) return null;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type === type) {
      return { depth, attrs: node.attrs };
    }
  }
  return null;
}

export function getActiveFormats(editor: Editor): ActiveFormats {
  return editor.action((ctx) => {
    const state = ctx.get(editorStateCtx);
    const { marks, nodes } = state.schema;

    const headingNode = findNodeAncestor(state, nodes.heading);
    const listItem = findNodeAncestor(state, nodes.list_item);

    return {
      heading: headingNode
        ? (headingNode.attrs.level as number) || false
        : false,
      bold: isMarkActive(state, marks.strong),
      italic: isMarkActive(state, marks.emphasis),
      quote: quoteDepth(state, nodes.blockquote) !== null,
      code: isMarkActive(state, marks.inlineCode),
      link: isMarkActive(state, marks.link),
      numberedList: !!findNodeAncestor(state, nodes.ordered_list),
      unorderedList:
        !!findNodeAncestor(state, nodes.bullet_list) &&
        !(listItem && listItem.attrs.checked != null),
      checklist: !!(listItem && listItem.attrs.checked != null),
      strikethrough: isMarkActive(state, marks.strike_through),
      underline: isMarkActive(state, marks.underline),
      subscript: isMarkActive(state, marks.subscript),
      superscript: isMarkActive(state, marks.superscript),
      table: !!findNodeAncestor(state, nodes.table),
      codeBlock: !!findNodeAncestor(state, nodes.code_block),
    };
  });
}

export function applyFormat(
  editor: Editor,
  type: FormatType,
  arg?: string,
): void {
  switch (type) {
    case "bold":
      editor.action(callCommand(toggleStrongCommand.key));
      break;
    case "italic":
      editor.action(callCommand(toggleEmphasisCommand.key));
      break;
    case "code":
      editor.action(callCommand(toggleInlineCodeCommand.key));
      break;
    case "strikethrough":
      editor.action(callCommand(toggleStrikethroughCommand.key));
      break;
    case "heading": {
      const level = Number.parseInt(arg || "1", 10) || 1;
      editor.action(callCommand(wrapInHeadingCommand.key, level));
      break;
    }
    case "quote":
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const tr = unquote(view.state);
        if (tr) view.dispatch(tr);
        else callCommand(wrapInBlockquoteCommand.key)(ctx);
      });
      break;
    case "numberedList":
      editor.action(callCommand(wrapInOrderedListCommand.key));
      break;
    case "unorderedList":
      editor.action(callCommand(wrapInBulletListCommand.key));
      break;
    case "checklist":
      toggleChecklist(editor);
      break;
    case "underline":
      editor.action(callCommand(toggleUnderlineCommand.key));
      break;
    case "subscript":
      editor.action(callCommand(toggleSubscriptCommand.key));
      break;
    case "superscript":
      editor.action(callCommand(toggleSuperscriptCommand.key));
      break;
    case "divider":
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const hr = view.state.schema.nodes.hr;
        const tr = hr && insertBlock(view.state, hr.create(), false);
        if (tr) view.dispatch(tr);
      });
      break;
    case "indent":
    case "outdent":
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const item = view.state.schema.nodes.list_item;
        if (!item) return;
        const move = type === "indent" ? sinkListItem : liftListItem;
        move(item)(view.state, view.dispatch);
      });
      break;
    case "clearFormatting":
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const tr = clearFormatting(view.state);
        if (tr) view.dispatch(tr);
      });
      break;
    case "codeBlock":
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const tr = toggleCodeBlock(view.state);
        if (tr) view.dispatch(tr);
      });
      break;
    case "table":
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const tr = insertTable(view.state);
        if (tr) view.dispatch(tr);
      });
      break;
  }
}

/**
 * The selection without its edges that only touch a line: dragged to the
 * end of a line, a selection reaches the start of the next one, and dragged
 * up from below it can start at the end of the line above, while selecting
 * nothing of either. Ends at the first and last text the selection covers,
 * counting an empty line it spans, or is the selection itself when it covers
 * no text (a caret).
 */
function coveredRange(state: EditorState): {
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

/** The depth of the innermost quote the covered selection starts in. */
function quoteDepth(
  state: EditorState,
  quote: NodeType | undefined,
): number | null {
  if (!quote) return null;
  const { $from } = coveredRange(state);
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === quote) return d;
  }
  return null;
}

/**
 * Takes the selected blocks out of the quote the selection starts in, one
 * level, or returns null when it starts outside a quote. The button reads as
 * on whenever it starts in one, and wrapping there put a quote inside the
 * quote instead of taking it off.
 *
 * Only the text the selection covers counts (see {@link coveredRange}), and
 * it is cut back to the quote's end: the blocks after the quote were never
 * in it.
 */
export function unquote(state: EditorState): Transaction | null {
  const quote = state.schema.nodes.blockquote;
  const depth = quoteDepth(state, quote);
  if (depth === null) return null;
  const { $from, $to } = coveredRange(state);
  const $end = state.doc.resolve(Math.min($to.pos, $from.end(depth)));
  const range = $from.blockRange($end, (node) => node.type === quote);
  const target = range && liftTarget(range);
  if (!range || target == null) return null;
  return state.tr.lift(range, target).scrollIntoView();
}

/**
 * Takes every mark but links off the selection, or off the caret's whole
 * paragraph when nothing is selected, and turns headings back into text.
 * Links stay: where one goes is part of the text, not its look. Lists and
 * quotes stay too, being the note's structure rather than its formatting.
 */
function clearFormatting(state: EditorState): Transaction | null {
  const { heading, paragraph } = state.schema.nodes;
  const { empty, $from, from, to } = state.selection;
  const start = empty ? $from.start() : from;
  const end = empty ? $from.end() : to;
  const tr = state.tr;
  for (const mark of Object.values(state.schema.marks)) {
    if (mark !== state.schema.marks.link) tr.removeMark(start, end, mark);
  }
  if (heading && paragraph) {
    state.doc.nodesBetween(start, end, (node, pos) => {
      if (node.type === heading) tr.setNodeMarkup(pos, paragraph);
      return true;
    });
  }
  tr.setStoredMarks([]);
  return tr.docChanged || state.storedMarks ? tr : null;
}

/**
 * Toggle list items between plain bullets and task items. If not already in
 * a list, wrap first. Then flip `checked` between `null` (plain) and `false`
 * (task, unchecked) on every list item in the selection.
 */
function toggleChecklist(editor: Editor): void {
  const pre = editor.action((ctx) => ctx.get(editorStateCtx));
  const listItemType = pre.schema.nodes.list_item;
  if (!listItemType) return;

  if (!findNodeAncestor(pre, listItemType)) {
    editor.action(callCommand(wrapInBulletListCommand.key));
  }

  editor.action((ctx) => {
    const state = ctx.get(editorStateCtx);
    const view = ctx.get(editorViewCtx);
    const current = findNodeAncestor(state, listItemType);
    const isTaskItem = !!(current && current.attrs.checked != null);

    const { from, to } = state.selection;
    const tr = state.tr;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type === listItemType) {
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          checked: isTaskItem ? null : false,
        });
      }
      return true;
    });
    if (tr.docChanged) view.dispatch(tr);
  });
}
