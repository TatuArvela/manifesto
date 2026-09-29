import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";

// How lists and checklist items sit in a ProseMirror document: what is a task
// item, how deep it is, and what removing one takes with it. Shared by the
// checklist node view, its drag, and the editor's "delete checked items".

export function isTaskItem(node: ProseNode): boolean {
  return node.type.name === "list_item" && node.attrs.checked != null;
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

/** Where the outermost list around `pos` ends inside, or -1 outside a list. */
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
 * (and around that) when it is that list's only item, so no empty list is
 * left behind.
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

/** Ticks or unticks the task item at `pos` and every task item inside it. */
export function toggleSubtreeChecked(
  view: EditorView,
  pos: number,
  checked: boolean,
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

  view.dispatch(tr);
}

/** Whether the document holds a ticked checklist item. */
export function docHasCheckedItems(doc: ProseNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.type.name === "list_item" && node.attrs.checked === true) {
      found = true;
      return false;
    }
  });
  return found;
}

/** Removes every ticked checklist item from the editor's document. */
export function deleteCheckedItemsIn(view: EditorView): void {
  // Delete one checked item at a time so getDeletionRange re-evaluates
  // ancestor lists after each removal (emptied single-child lists get
  // pruned on the next pass).
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
    });
    if (targetPos < 0) break;
    const range = getDeletionRange(doc, targetPos, targetSize);
    view.dispatch(view.state.tr.delete(range.from, range.to));
  }
}
