import { nodeViewCtx, prosePluginsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { liftListItem, sinkListItem } from "@milkdown/kit/prose/schema-list";
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
} from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeViewConstructor,
} from "@milkdown/kit/prose/view";

const INDENT_PX = 24;
const DRAG_THRESHOLD_PX = 4;
const INDICATOR_HEIGHT_PX = 2;

type TaskItemInfo = {
  pos: number;
  nodeSize: number;
  level: number;
  dom: HTMLElement;
  label: HTMLElement;
  labelX: number;
};

type DragState = {
  view: EditorView;
  sourcePos: number;
  sourceNodeSize: number;
  sourceLevel: number;
  sourceIdx: number;
  sourceDom: HTMLElement;
  startX: number;
  startY: number;
  pointerId: number;
  active: boolean;
  items: TaskItemInfo[];
  slot: number;
  targetLevel: number;
  indicator: HTMLElement;
  onMove: (e: PointerEvent) => void;
  onUp: (e: PointerEvent) => void;
  onCancel: (e: PointerEvent) => void;
  onKeyDown: (e: KeyboardEvent) => void;
};

let dragState: DragState | null = null;

function isTaskItem(node: ProseNode): boolean {
  return node.type.name === "list_item" && node.attrs.checked != null;
}

function toggleSubtreeChecked(
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

function getItemLevel(doc: ProseNode, pos: number): number {
  const $pos = doc.resolve(pos);
  let level = 0;
  for (let d = 0; d <= $pos.depth; d++) {
    const name = $pos.node(d).type.name;
    if (name === "bullet_list" || name === "ordered_list") level++;
  }
  return level;
}

function collectTaskItems(view: EditorView): TaskItemInfo[] {
  const items: TaskItemInfo[] = [];
  view.state.doc.descendants((node, pos) => {
    if (!isTaskItem(node)) return;
    const level = getItemLevel(view.state.doc, pos);
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return;
    const label = dom.querySelector(":scope > label");
    if (!(label instanceof HTMLElement)) return;
    const labelRect = label.getBoundingClientRect();
    items.push({
      pos,
      nodeSize: node.nodeSize,
      level,
      dom,
      label,
      labelX: labelRect.left,
    });
  });
  return items;
}

function findSlot(items: TaskItemInfo[], y: number): number {
  for (let i = 0; i < items.length; i++) {
    const rect = items[i].label.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) return i;
  }
  return items.length;
}

function computeTargetLevel(
  items: TaskItemInfo[],
  slot: number,
  sourceIdx: number,
  sourceLevel: number,
  deltaX: number,
): number {
  let aboveIdx = slot - 1;
  if (aboveIdx === sourceIdx) aboveIdx--;
  const above = aboveIdx >= 0 ? items[aboveIdx] : null;

  let belowIdx = slot;
  if (belowIdx === sourceIdx) belowIdx++;
  const below = belowIdx < items.length ? items[belowIdx] : null;

  const maxLevel = above ? above.level + 1 : 1;
  const minLevel = below ? below.level : 1;
  const desired = sourceLevel + Math.round(deltaX / INDENT_PX);
  return Math.max(minLevel, Math.min(maxLevel, desired));
}

function levelXFor(
  view: EditorView,
  items: TaskItemInfo[],
  level: number,
): number {
  const sameLevel = items.find((i) => i.level === level);
  if (sameLevel) return sameLevel.labelX;
  const lev1 = items.find((i) => i.level === 1);
  const lev2 = items.find((i) => i.level === 2);
  const editorRect = view.dom.getBoundingClientRect();
  if (lev1 && lev2) {
    const delta = lev2.labelX - lev1.labelX;
    return lev1.labelX + (level - 1) * delta;
  }
  if (lev1) {
    return lev1.labelX + (level - 1) * INDENT_PX;
  }
  return editorRect.left + (level - 1) * INDENT_PX;
}

function slotY(items: TaskItemInfo[], slot: number): number {
  if (items.length === 0) return 0;
  if (slot >= items.length) {
    const last = items[items.length - 1];
    return Math.max(
      last.label.getBoundingClientRect().bottom,
      last.dom.getBoundingClientRect().bottom,
    );
  }
  return items[slot].label.getBoundingClientRect().top;
}

function positionIndicator(state: DragState) {
  const y = slotY(state.items, state.slot);
  const x = levelXFor(state.view, state.items, state.targetLevel);
  const editorRect = state.view.dom.getBoundingClientRect();
  state.indicator.style.top = `${y - INDICATOR_HEIGHT_PX / 2}px`;
  state.indicator.style.left = `${x}px`;
  state.indicator.style.width = `${Math.max(editorRect.right - x - 4, 40)}px`;
}

function createIndicator(): HTMLElement {
  const el = document.createElement("div");
  el.className = "task-item-drop-indicator";
  return el;
}

function getDeletionRange(
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

function applyDrop(state: DragState) {
  const {
    view,
    sourcePos,
    sourceNodeSize,
    sourceLevel,
    sourceIdx,
    items,
    slot,
    targetLevel,
  } = state;
  const doc = view.state.doc;

  const sourceNode = doc.nodeAt(sourcePos);
  if (!sourceNode || !isTaskItem(sourceNode)) return;

  const isNoMove = slot === sourceIdx || slot === sourceIdx + 1;
  let startLevel: number;

  if (isNoMove) {
    startLevel = sourceLevel;
    const tr = view.state.tr;
    tr.setSelection(TextSelection.near(tr.doc.resolve(sourcePos + 1)));
    view.dispatch(tr);
  } else {
    let insertAt: number;
    if (slot < items.length) {
      const next = items[slot];
      insertAt = next.pos;
      startLevel = next.level;
    } else {
      const last = items[items.length - 1];
      const $last = doc.resolve(last.pos);
      let outerListDepth = -1;
      for (let depth = $last.depth; depth >= 1; depth--) {
        const name = $last.node(depth).type.name;
        if (name === "bullet_list" || name === "ordered_list")
          outerListDepth = depth;
      }
      if (outerListDepth < 0) return;
      insertAt = $last.end(outerListDepth);
      startLevel = 1;
    }

    const sliceContent = doc.slice(
      sourcePos,
      sourcePos + sourceNodeSize,
    ).content;
    const delRange = getDeletionRange(doc, sourcePos, sourceNodeSize);

    const tr = view.state.tr;
    let movedPos: number;

    if (delRange.from < insertAt) {
      tr.insert(insertAt, sliceContent);
      tr.delete(delRange.from, delRange.to);
      movedPos = insertAt - (delRange.to - delRange.from);
    } else {
      tr.delete(delRange.from, delRange.to);
      tr.insert(insertAt, sliceContent);
      movedPos = insertAt;
    }

    tr.setSelection(TextSelection.near(tr.doc.resolve(movedPos + 1)));
    view.dispatch(tr);
  }

  const steps = targetLevel - startLevel;
  const listItemType = view.state.schema.nodes.list_item;
  if (!listItemType) return;
  for (let i = 0; i < Math.abs(steps); i++) {
    const cmd =
      steps > 0 ? sinkListItem(listItemType) : liftListItem(listItemType);
    cmd(view.state, view.dispatch);
  }
}

function endDrag(commit: boolean) {
  if (!dragState) return;
  const state = dragState;
  dragState = null;

  state.sourceDom.classList.remove("task-item-dragging");
  state.indicator.remove();
  document.removeEventListener("pointermove", state.onMove, true);
  document.removeEventListener("pointerup", state.onUp, true);
  document.removeEventListener("pointercancel", state.onCancel, true);
  document.removeEventListener("keydown", state.onKeyDown, true);

  if (commit && state.active) {
    try {
      applyDrop(state);
    } catch {
      // View may have been torn down mid-drop; swallow to keep cleanup clean.
    }
  }
}

function onPointerMove(e: PointerEvent) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  e.preventDefault();

  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;

  if (!dragState.active) {
    if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    dragState.active = true;
    dragState.sourceDom.classList.add("task-item-dragging");
  }

  dragState.slot = findSlot(dragState.items, e.clientY);
  dragState.targetLevel = computeTargetLevel(
    dragState.items,
    dragState.slot,
    dragState.sourceIdx,
    dragState.sourceLevel,
    e.clientX - dragState.startX,
  );
  positionIndicator(dragState);
}

const createTaskItemView: NodeViewConstructor = (node, view, getPos) => {
  const listItem = document.createElement("li");
  const handleWrapper = document.createElement("div");
  const checkboxWrapper = document.createElement("label");
  const checkboxStyler = document.createElement("span");
  const checkbox = document.createElement("input");
  const content = document.createElement("div");
  const deleteButton = document.createElement("button");
  content.className = "task-item-content";

  const setItemAttrs = (n: ProseNode) => {
    listItem.dataset.itemType = "task";
    listItem.dataset.checked = String(n.attrs.checked);
    if (n.attrs.label != null) listItem.dataset.label = String(n.attrs.label);
    if (n.attrs.listType != null)
      listItem.dataset.listType = String(n.attrs.listType);
    if (n.attrs.spread != null)
      listItem.dataset.spread = String(n.attrs.spread);
  };

  handleWrapper.contentEditable = "false";
  handleWrapper.className =
    "task-item-drag-handle text-black/40 dark:text-white/40 cursor-grab active:cursor-grabbing";
  handleWrapper.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
  handleWrapper.setAttribute("aria-label", "Drag to reorder");

  checkboxWrapper.contentEditable = "false";
  checkbox.type = "checkbox";
  checkbox.addEventListener("mousedown", (event) => event.preventDefault());
  checkbox.addEventListener("change", (event) => {
    if (!view.editable) {
      checkbox.checked = !checkbox.checked;
      return;
    }
    const { checked } = event.target as HTMLInputElement;
    if (typeof getPos !== "function") return;
    const position = getPos();
    if (typeof position !== "number") return;
    toggleSubtreeChecked(view, position, checked);
  });

  handleWrapper.addEventListener("pointerdown", (e: PointerEvent) => {
    if (!view.editable) return;
    if (e.button !== 0) return;
    const pos = typeof getPos === "function" ? (getPos() ?? -1) : -1;
    if (pos < 0) return;

    e.stopPropagation();
    e.preventDefault();

    const allItems = collectTaskItems(view);
    const sourceRaw = allItems.find((i) => i.pos === pos);
    if (!sourceRaw) return;
    const items = allItems.filter(
      (i) =>
        i.pos === sourceRaw.pos ||
        i.pos < sourceRaw.pos ||
        i.pos >= sourceRaw.pos + sourceRaw.nodeSize,
    );
    const sourceIdx = items.findIndex((i) => i.pos === pos);
    if (sourceIdx < 0) return;
    const source = items[sourceIdx];

    const indicator = createIndicator();
    document.body.appendChild(indicator);

    const onMove = (ev: PointerEvent) => onPointerMove(ev);
    const onUp = (ev: PointerEvent) => {
      if (!dragState || ev.pointerId !== dragState.pointerId) return;
      endDrag(true);
    };
    const onCancel = (ev: PointerEvent) => {
      if (!dragState || ev.pointerId !== dragState.pointerId) return;
      endDrag(false);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") endDrag(false);
    };

    dragState = {
      view,
      sourcePos: source.pos,
      sourceNodeSize: source.nodeSize,
      sourceLevel: source.level,
      sourceIdx,
      sourceDom: listItem,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      active: false,
      items,
      slot: sourceIdx,
      targetLevel: source.level,
      indicator,
      onMove,
      onUp,
      onCancel,
      onKeyDown,
    };

    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onCancel, true);
    document.addEventListener("keydown", onKeyDown, true);

    try {
      handleWrapper.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture is best-effort; document-level listeners drive the drag.
    }
  });

  // Suppress the native HTML5 drag from a draggable ancestor (e.g. the note card).
  handleWrapper.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  handleWrapper.addEventListener("dragstart", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  setItemAttrs(node);
  checkbox.checked = node.attrs.checked === true;

  deleteButton.type = "button";
  deleteButton.contentEditable = "false";
  deleteButton.className = "task-item-delete text-black/40 dark:text-white/40";
  deleteButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  deleteButton.setAttribute("aria-label", "Remove item");
  deleteButton.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  deleteButton.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!view.editable) return;
    if (typeof getPos !== "function") return;
    const position = getPos();
    if (typeof position !== "number") return;
    const current = view.state.doc.nodeAt(position);
    if (!current || !isTaskItem(current)) return;
    const delRange = getDeletionRange(
      view.state.doc,
      position,
      current.nodeSize,
    );
    view.dispatch(view.state.tr.delete(delRange.from, delRange.to));
    view.focus();
  });

  checkboxWrapper.append(checkbox, checkboxStyler);
  listItem.append(handleWrapper, checkboxWrapper, content, deleteButton);

  const syncHandleVisibility = () => {
    const display = view.editable ? "" : "none";
    handleWrapper.style.display = display;
    deleteButton.style.display = display;
  };
  syncHandleVisibility();

  return {
    dom: listItem,
    contentDOM: content,
    stopEvent: (event: Event) => {
      const target = event.target as HTMLElement;
      if (handleWrapper.contains(target)) return true;
      if (checkboxWrapper.contains(target)) return true;
      if (deleteButton.contains(target)) return true;
      return false;
    },
    ignoreMutation: (mutation) => {
      if (mutation.type === "selection") return false;
      if (mutation.target === listItem && mutation.type === "attributes") {
        return true;
      }
      const target = mutation.target as Node;
      if (handleWrapper.contains(target)) return true;
      if (checkboxWrapper.contains(target)) return true;
      if (deleteButton.contains(target)) return true;
      return false;
    },
    update: (updatedNode) => {
      if (updatedNode.type !== node.type) return false;
      if (!isTaskItem(updatedNode)) return false;
      setItemAttrs(updatedNode);
      checkbox.checked = updatedNode.attrs.checked === true;
      syncHandleVisibility();
      return true;
    },
    destroy: () => {
      if (dragState && dragState.sourceDom === listItem) endDrag(false);
    },
  };
};

/**
 * Wraps task list items (list_item with checked != null) in a NodeView that
 * renders a drag handle, a styled checkbox, and supports pointer-based drag
 * reorder with indent/outdent across the task subtree. Plain list_items
 * (checked == null) fall back to default rendering.
 */
const listItemView: NodeViewConstructor = (
  node,
  view,
  getPos,
  decorations,
  innerDecorations,
) => {
  if (isTaskItem(node)) {
    return createTaskItemView(
      node,
      view,
      getPos,
      decorations,
      innerDecorations,
    );
  }
  // Plain list items: defer to default-style rendering with mirrored data attrs.
  const li = document.createElement("li");
  const contentEl = document.createElement("div");
  li.appendChild(contentEl);
  const syncAttrs = (n: ProseNode) => {
    if (n.attrs.label != null) li.dataset.label = String(n.attrs.label);
    if (n.attrs.listType != null)
      li.dataset.listType = String(n.attrs.listType);
    if (n.attrs.spread != null) li.dataset.spread = String(n.attrs.spread);
  };
  syncAttrs(node);
  return {
    dom: li,
    contentDOM: contentEl,
    update: (updated) => {
      if (updated.type !== node.type) return false;
      if (updated.attrs.checked != null) return false;
      syncAttrs(updated);
      return true;
    },
  };
};

const activeTaskItemKey = new PluginKey("manifestoActiveTaskItem");

function buildActiveTaskItemDecorations(state: EditorState): DecorationSet {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (isTaskItem(node)) {
      const pos = $from.before(d);
      return DecorationSet.create(state.doc, [
        Decoration.node(pos, pos + node.nodeSize, {
          class: "task-item-active",
        }),
      ]);
    }
  }
  return DecorationSet.empty;
}

const activeTaskItemPlugin = new Plugin({
  key: activeTaskItemKey,
  state: {
    init: (_config, state) => buildActiveTaskItemDecorations(state),
    apply: (tr, old, _oldState, newState) => {
      if (!tr.docChanged && !tr.selectionSet) return old;
      return buildActiveTaskItemDecorations(newState);
    },
  },
  props: {
    decorations(state) {
      return activeTaskItemKey.getState(state);
    },
  },
});

export const taskItemDraggable: MilkdownPlugin = (ctx) => () => {
  ctx.update(nodeViewCtx, (views) => [
    ...views,
    ["list_item", listItemView] as [string, NodeViewConstructor],
  ]);
  ctx.update(prosePluginsCtx, (plugins) => [...plugins, activeTaskItemPlugin]);
};
