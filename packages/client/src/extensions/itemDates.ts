import { prosePluginsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import {
  findItemDate,
  itemDateClass,
  localIsoDate,
  UNDATED,
} from "../utils/itemDate.js";
import { isListNode, isTaskItem } from "./taskListStructure.js";

// Dates on checklist items in the editor (see `utils/itemDate.ts`). The token
// stays ordinary text in the item, so the schema is untouched; a decoration
// draws it as the chip the card shows.

/**
 * The date token in a task item's own text, with its offsets from the item's
 * position, or null. Text marked as code is quoted, and an item nested in
 * this one answers for itself.
 */
function itemDateOf(
  item: ProseNode,
): { date: string; from: number; to: number } | null {
  const label = item.firstChild;
  if (label?.type.name !== "paragraph") return null;
  let found: { date: string; from: number; to: number } | null = null;
  label.forEach((child, offset) => {
    if (found || !child.isText) return;
    if (child.marks.some((mark) => mark.type.spec.code === true)) return;
    const token = findItemDate(child.text ?? "");
    if (!token) return;
    // +1 into the item, +1 into its paragraph.
    const base = 2 + offset;
    found = {
      date: token.date,
      from: base + token.start,
      to: base + token.end,
    };
  });
  return found;
}

function chips(doc: ProseNode): DecorationSet {
  const today = localIsoDate(new Date());
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!isTaskItem(node)) return true;
    const found = itemDateOf(node);
    if (found) {
      decorations.push(
        Decoration.inline(pos + found.from, pos + found.to, {
          class: itemDateClass(found.date, node.attrs.checked === true, today),
        }),
      );
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

const itemDatesKey = new PluginKey<DecorationSet>("manifestoItemDates");

const chipPlugin = new Plugin<DecorationSet>({
  key: itemDatesKey,
  state: {
    init: (_config, state) => chips(state.doc),
    // Ticking an item changes the document too, so this is the only trigger.
    apply: (tr, old) => (tr.docChanged ? chips(tr.doc) : old),
  },
  props: {
    decorations: (state) => itemDatesKey.getState(state),
  },
});

export const itemDatesPlugin: MilkdownPlugin = (ctx) => () => {
  ctx.update(prosePluginsCtx, (plugins) => [...plugins, chipPlugin]);
};

/** Whether the document holds a dated checklist item. */
export function docHasDatedItems(doc: ProseNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (isTaskItem(node) && itemDateOf(node)) found = true;
    return !found;
  });
  return found;
}

/** `node` with the items of every list in it in date order, undated last. */
function withSortedLists(node: ProseNode): ProseNode {
  if (node.isLeaf || node.isText) return node;
  const children: ProseNode[] = [];
  node.forEach((child) => {
    children.push(withSortedLists(child));
  });
  if (isListNode(node)) {
    const keys = new Map(
      children.map((child) => [
        child,
        (isTaskItem(child) ? itemDateOf(child)?.date : undefined) ?? UNDATED,
      ]),
    );
    const key = (child: ProseNode) => keys.get(child) ?? UNDATED;
    // Stable, so equal dates and the undated keep the order they were in.
    children.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }
  return node.type.create(node.attrs, children, node.marks);
}

/**
 * Puts the checklist items of the editor's document in date order, each among
 * its siblings, as `sortChecklistByDate` does for Markdown. Only the lists
 * whose order changes are replaced, so in a shared document the rest is not
 * rewritten under someone else's caret.
 */
export function sortItemsByDateIn(view: EditorView): void {
  const { doc } = view.state;
  const changed: { pos: number; from: ProseNode; to: ProseNode }[] = [];
  doc.descendants((node, pos) => {
    if (!isListNode(node)) return true;
    const sorted = withSortedLists(node);
    if (!sorted.eq(node)) changed.push({ pos, from: node, to: sorted });
    // Nested lists were sorted with this one.
    return false;
  });
  if (changed.length === 0) return;
  const { tr } = view.state;
  // Last first: a sorted list is the size it was, but this way no position
  // has to be mapped at all.
  for (const { pos, from, to } of changed.reverse()) {
    tr.replaceWith(pos, pos + from.nodeSize, to);
  }
  view.dispatch(tr);
}
