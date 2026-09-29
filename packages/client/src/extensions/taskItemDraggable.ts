import { nodeViewCtx, prosePluginsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { type EditorState, Plugin, PluginKey } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type NodeViewConstructor,
} from "@milkdown/kit/prose/view";
import { emptyParagraphAroundListKeymap } from "./listParagraphKeymap.js";
import { endTaskItemDragOf, startTaskItemDrag } from "./taskItemDrag.js";
import {
  getDeletionRange,
  isTaskItem,
  toggleSubtreeChecked,
} from "./taskListStructure.js";

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

    startTaskItemDrag(view, listItem, handleWrapper, pos, e);
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
  // Out of the tab order: it is drawn only on hover or for the item holding
  // the caret, so tabbing out of a checklist crossed one invisible stop per
  // item. A keyboard user removes an item by deleting its text instead.
  deleteButton.tabIndex = -1;
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
      endTaskItemDragOf(listItem);
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
  ctx.update(prosePluginsCtx, (plugins) => [
    ...plugins,
    emptyParagraphAroundListKeymap,
    activeTaskItemPlugin,
  ]);
};
