import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { liftListItem, wrapInList } from "@milkdown/kit/prose/schema-list";
import {
  type EditorState,
  TextSelection,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { coveredRange } from "./coveredRange.js";

// The toolbar's three list buttons in the rich editor. Raw mode's are in
// `utils/rawLineFormatting.ts`.

export type ListKind = "bullet" | "ordered" | "task";

/** Just what is needed of an `EditorView`, so a test can stand in for one. */
export interface ListView {
  readonly state: EditorState;
  dispatch(tr: Transaction): void;
}

/** The list kind a list item is, from its list and its `checked`. */
function kindOf(list: ProseNode, item: ProseNode): ListKind {
  if (item.attrs.checked != null) return "task";
  return list.type.name === "ordered_list" ? "ordered" : "bullet";
}

/**
 * Where each text block between `from` and `to` (by default, the text the
 * selection covers) starts, with the list item it is in.
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

/** Selects from the first covered block's start to the last one's end. */
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
 * Line breaks in the covered paragraphs become paragraph breaks, so each line
 * becomes an item of its own. Done last line first, so earlier positions hold.
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
 * Lifts every selected block out of its list, one block at a time, until
 * none is in a list or nothing moves. A block at a time, because one lift
 * over the whole selection only lifts when it all sits in one list: half in
 * a list, nothing moved. A nested item comes out a level per lift, so it
 * ends up after the list rather than as a line of the item above it.
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
 * - Every selected line becomes an item of its own, a line break within a
 *   paragraph included. Milkdown's `wrapInBulletListCommand` wraps the
 *   selection in one list item, so three lines became one item.
 * - When every selected line already is that kind of item, they come out of
 *   the list altogether: pressed twice, a button gives back plain lines.
 * - When they are all items of another kind, their list changes kind in
 *   place, nesting and all. A list's type is the whole list's in Markdown,
 *   so its other items change with it.
 * - Otherwise the selected items are lifted out first and everything is
 *   wrapped afresh, so a selection half in a list ends up as one list.
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
      // Milkdown writes each item's marker from the item's own `listType`
      // and `label`, not its list's, so they change with the list.
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
