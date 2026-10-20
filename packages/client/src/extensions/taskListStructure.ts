import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

// How lists and checklist items are in a ProseMirror document: what is a task
// item, its depth, and what its removal takes with it. The checklist node view,
// its drag, and "delete checked items" of the editor share it.

export function isTaskItem(node: ProseNode): boolean {
  return node.type.name === "list_item" && node.attrs.checked != null;
}

/** The innermost checklist item around the caret, or null. */
export function activeTaskItem(
  state: EditorState,
): { node: ProseNode; pos: number } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (isTaskItem(node)) return { node, pos: $from.before(depth) };
  }
  return null;
}

export function isListNode(node: ProseNode): boolean {
  return node.type.name === "bullet_list" || node.type.name === "ordered_list";
}

/** How many lists deep the item at `pos` is: 1 for a top-level item. */
export function getItemLevel(doc: ProseNode, pos: number): number {
  const $pos = doc.resolve(pos);
  let level = 0;
  for (let d = 0; d <= $pos.depth; d++) {
    const name = $pos.node(d).type.name;
    if (name === "bullet_list" || name === "ordered_list") level++;
  }
  return level;
}

/** Where the outermost list around `pos` starts, or -1 outside a list. */
export function getOuterListPos(doc: ProseNode, pos: number): number {
  const $pos = doc.resolve(pos);
  for (let depth = 1; depth <= $pos.depth; depth++) {
    const parent = $pos.node(depth);
    if (
      parent.type.name === "bullet_list" ||
      parent.type.name === "ordered_list"
    ) {
      return $pos.before(depth);
    }
  }
  return -1;
}

/**
 * Where the inside of the outermost list around `pos` ends, or -1 outside a
 * list.
 */
export function endOfOuterList(doc: ProseNode, pos: number): number {
  const $pos = doc.resolve(pos);
  let outerListDepth = -1;
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const name = $pos.node(depth).type.name;
    if (name === "bullet_list" || name === "ordered_list")
      outerListDepth = depth;
  }
  if (outerListDepth < 0) return -1;
  return $pos.end(outerListDepth);
}

/**
 * What to delete to remove the item at `pos`: the item, or the list around it
 * (and around that) when it is the only item of that list. Thus, no empty list
 * stays.
 */
export function getDeletionRange(
  doc: ProseNode,
  pos: number,
  nodeSize: number,
): { from: number; to: number } {
  let from = pos;
  let to = pos + nodeSize;
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const parent = $pos.node(depth);
    if (
      parent.type.name !== "bullet_list" &&
      parent.type.name !== "ordered_list"
    )
      break;
    if (parent.childCount !== 1) break;
    from = $pos.before(depth);
    to = $pos.after(depth);
  }
  return { from, to };
}

/** `node`, with the items of each list in it in the order of `keyOf`. */
function withSortedLists(
  node: ProseNode,
  keyOf: (item: ProseNode) => string,
): ProseNode {
  if (node.isLeaf || node.isText) return node;
  const children: ProseNode[] = [];
  node.forEach((child) => {
    children.push(withSortedLists(child, keyOf));
  });
  if (isListNode(node)) {
    const keys = new Map(children.map((child) => [child, keyOf(child)]));
    const key = (child: ProseNode) => keys.get(child) ?? "";
    // Stable. Thus, items with the same key keep their order.
    children.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }
  return node.type.create(node.attrs, children, node.marks);
}

/**
 * Puts the items of each list in the document of `tr` in the order of `keyOf`,
 * smallest first, each among its siblings, as `sortChecklist` does for
 * Markdown. The code replaces only the lists whose order changes. Thus, in a
 * shared document, the other lists are not written again under the caret of a
 * different person. Returns if anything moved.
 */
export function sortListItems(
  tr: Transaction,
  keyOf: (item: ProseNode) => string,
): boolean {
  const changed: { pos: number; from: ProseNode; to: ProseNode }[] = [];
  tr.doc.descendants((node, pos) => {
    if (!isListNode(node)) return true;
    const sorted = withSortedLists(node, keyOf);
    if (!sorted.eq(node)) changed.push({ pos, from: node, to: sorted });
    // Nested lists were sorted with this one.
    return false;
  });
  // Last first. A sorted list has its previous size, but in this order no
  // position must be mapped.
  for (const { pos, from, to } of changed.reverse()) {
    tr.replaceWith(pos, pos + from.nodeSize, to);
  }
  return changed.length > 0;
}

/** The order that "checked items last" keeps: ticked items after the others. */
export const checkedLastKey = (item: ProseNode): string =>
  isTaskItem(item) && item.attrs.checked === true ? "1" : "0";

/**
 * Ticks or unticks the task item at `pos`, and each task item inside it. With
 * `checkedLast`, ticked items then move below the items that are not done, in
 * the same step. Thus, one undo restores both.
 */
export function toggleSubtreeChecked(
  view: EditorView,
  pos: number,
  checked: boolean,
  checkedLast = false,
): void {
  const { tr } = view.state;
  const node = tr.doc.nodeAt(pos);
  if (!node || !isTaskItem(node)) return;

  tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });

  node.descendants((child, childPos) => {
    if (isTaskItem(child)) {
      tr.setNodeMarkup(pos + 1 + childPos, undefined, {
        ...child.attrs,
        checked,
      });
    }
  });

  if (checkedLast) sortListItems(tr, checkedLastKey);
  view.dispatch(tr);
}

/** Unticks each checklist item in the document of the editor. */
export function uncheckAllIn(view: EditorView): void {
  const { tr } = view.state;
  tr.doc.descendants((node, pos) => {
    if (isTaskItem(node) && node.attrs.checked === true) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
    }
    return true;
  });
  if (tr.docChanged) view.dispatch(tr);
}

/** If the document contains a ticked checklist item. */
export function docHasCheckedItems(doc: ProseNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.type.name === "list_item" && node.attrs.checked === true) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

/** Removes each ticked checklist item from the document of the editor. */
export function deleteCheckedItemsIn(view: EditorView): void {
  // Delete one checked item at a time. Thus, getDeletionRange evaluates the
  // ancestor lists again after each removal (single-child lists that became
  // empty are pruned on the next pass).
  while (true) {
    const { doc } = view.state;
    let targetPos = -1;
    let targetSize = 0;
    doc.descendants((node, pos) => {
      if (targetPos >= 0) return false;
      if (node.type.name === "list_item" && node.attrs.checked === true) {
        targetPos = pos;
        targetSize = node.nodeSize;
        return false;
      }
      return true;
    });
    if (targetPos < 0) break;
    const range = getDeletionRange(doc, targetPos, targetSize);
    view.dispatch(view.state.tr.delete(range.from, range.to));
  }
}
