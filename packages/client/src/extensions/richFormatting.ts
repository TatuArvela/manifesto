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
import type { MarkType, NodeType } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";
import { callCommand } from "@milkdown/kit/utils";
import type { ActiveFormats, FormatType } from "../utils/formatTypes.js";
import {
  toggleSubscriptCommand,
  toggleSuperscriptCommand,
  toggleUnderlineCommand,
} from "./manifestoInlineMarks.js";

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
      quote: !!findNodeAncestor(state, nodes.blockquote),
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
      editor.action(callCommand(wrapInBlockquoteCommand.key));
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
  }
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
