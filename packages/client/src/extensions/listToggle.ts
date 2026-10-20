import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { liftListItem, wrapInList } from "@milkdown/kit/prose/schema-list";
import {
  type EditorState,
  TextSelection,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { coveredRange } from "./coveredRange.ts";

// The three list buttons of the toolbar in the rich editor. Those of raw mode
// are in `utils/rawLineFormatting.ts`.

export type ListKind = "bullet" | "ordered" | "task";

/**
 * Only the parts of an `EditorView` that are necessary. Thus, a test can
 * replace one.
 */
export interface ListView {
  readonly state: EditorState;
  dispatch(tr: Transaction): void;
}

/** The list type of a list item, from its list and its `checked`. */
function kindOf(list: ProseNode, item: ProseNode): ListKind {
  if (item.attrs.checked != null) return "task";
  return list.type.name === "ordered_list" ? "ordered" : "bullet";
}

/**
 * Where each text block between `from` and `to` (by default, the text that the
 * selection covers) starts, with the list item that contains it.
 */
function coveredBlocks(state: EditorState, from?: number, to?: number) {
  const item = state.schema.nodes.list_item;
  const covered = coveredRange(state);
  const $from = from === undefined ? covered.$from : state.doc.resolve(from);
  const $to = to === undefined ? covered.$to : state.doc.resolve(to);
  const blocks: {
    pos: number;
    item: { node: ProseNode; pos: number; list: ProseNode } | null;
  }[] = [];
  state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
    if (!node.isTextblock) return true;
    const $in = state.doc.resolve(pos + 1);
    let found: { node: ProseNode; pos: number; list: ProseNode } | null = null;
    for (let d = $in.depth; d > 1 && !found; d--) {
      if ($in.node(d).type === item) {
        found = {
          node: $in.node(d),
          pos: $in.before(d),
          list: $in.node(d - 1),
        };
      }
    }
    blocks.push({ pos, item: found });
    return false;
  });
  return blocks;
}

/**
 * Selects from the start of the first covered block to the end of the last one.
 */
function selectCovered(view: ListView) {
  const { $from, $to } = coveredRange(view.state);
  const from = $from.start();
  const to = $to.end();
  if (view.state.selection.from === from && view.state.selection.to === to) {
    return;
  }
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)),
  );
}

/**
 * Line breaks in the covered paragraphs become paragraph breaks. Thus, each
 * line becomes its own item. The code does the last line first. Thus, earlier
 * positions stay correct.
 */
function splitLines(view: ListView) {
  const { state } = view;
  const breaks: number[] = [];
  const { $from, $to } = coveredRange(state);
  state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
    if (node.type.name === "hardbreak" && pos >= $from.pos && pos < $to.pos) {
      breaks.push(pos);
    }
    return true;
  });
  if (breaks.length === 0) return;
  const tr = state.tr;
  for (const pos of breaks.reverse()) {
    tr.delete(pos, pos + 1).split(pos);
  }
  view.dispatch(tr);
}

/**
 * Lifts each selected block out of its list, one block at a time, until none is
 * in a list or nothing moves. One block at a time, because one lift over the
 * full selection only works when all of it is in one list. Half in a list,
 * nothing moved. A nested item comes out one level for each lift. Thus, it goes
 * after the list, not into a line of the item above it.
 */
function liftOut(view: ListView) {
  const item = view.state.schema.nodes.list_item;
  if (!item) return;
  let { from, to } = view.state.selection;
  const send = (tr: Transaction) => {
    from = tr.mapping.map(from, -1);
    to = tr.mapping.map(to, 1);
    view.dispatch(tr);
  };
  for (let guard = 0; guard < 64; guard++) {
    const target = coveredBlocks(view.state, from, to).find((b) => b.item);
    if (!target) break;
    send(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, target.pos + 1),
      ),
    );
    if (!liftListItem(item)(view.state, send)) break;
  }
  send(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)),
  );
}

/** Sets `checked` on the covered items: false for a task, null otherwise. */
function markItems(view: ListView, kind: ListKind) {
  const tr = view.state.tr;
  const seen = new Set<number>();
  for (const block of coveredBlocks(view.state)) {
    if (!block.item || seen.has(block.item.pos)) continue;
    seen.add(block.item.pos);
    const checked =
      kind === "task" ? (block.item.node.attrs.checked ?? false) : null;
    if (block.item.node.attrs.checked === checked) continue;
    tr.setNodeMarkup(block.item.pos, undefined, {
      ...block.item.node.attrs,
      checked,
    });
  }
  if (tr.docChanged) view.dispatch(tr);
}

/**
 * The Bullet, Numbered and Checklist buttons.
 *
 * - Each selected line becomes its own item, also a line break within a
 *   paragraph. The `wrapInBulletListCommand` of Milkdown wraps the selection in
 *   one list item. Thus, three lines became one item.
 * - When each selected line is already that type of item, they come out of the
 *   list fully. Thus, a button pushed two times gives back plain lines.
 * - When they are all items of a different type, their list changes type in
 *   place, with its nesting. In Markdown, the type of a list applies to the
 *   full list. Thus, its other items change with it.
 * - Otherwise, the code first lifts the selected items out, and wraps all
 *   again. Thus, a selection that is half in a list becomes one list.
 */
export function toggleList(view: ListView, kind: ListKind): void {
  const { bullet_list, ordered_list } = view.state.schema.nodes;
  if (!bullet_list || !ordered_list) return;
  const listType = kind === "ordered" ? ordered_list : bullet_list;

  splitLines(view);
  selectCovered(view);
  const blocks = coveredBlocks(view.state);
  if (blocks.length === 0) return;

  if (
    blocks.every((b) => b.item && kindOf(b.item.list, b.item.node) === kind)
  ) {
    liftOut(view);
    return;
  }

  if (blocks.every((b) => b.item)) {
    const tr = view.state.tr;
    const lists = new Set<number>();
    for (const block of blocks) {
      if (!block.item) continue;
      const $item = view.state.doc.resolve(block.item.pos);
      const listPos = $item.before();
      if (lists.has(listPos) || block.item.list.type === listType) continue;
      lists.add(listPos);
      tr.setNodeMarkup(listPos, listType);
      // Milkdown writes the marker of each item from the own `listType` and
      // `label` of the item, not those of its list. Thus, they change with the
      // list.
      block.item.list.forEach((child, offset) => {
        tr.setNodeMarkup(listPos + 1 + offset, undefined, {
          ...child.attrs,
          listType: kind === "ordered" ? "ordered" : "bullet",
          label: kind === "ordered" ? child.attrs.label : "•",
        });
      });
    }
    if (tr.docChanged) view.dispatch(tr);
    markItems(view, kind);
    return;
  }

  liftOut(view);
  if (!wrapInList(listType)(view.state, (tr) => view.dispatch(tr))) return;
  markItems(view, kind);
}
