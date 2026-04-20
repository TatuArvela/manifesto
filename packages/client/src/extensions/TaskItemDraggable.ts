import { type Editor, getRenderedAttributes } from "@tiptap/core";
import TaskItem from "@tiptap/extension-task-item";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

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
  editor: Editor;
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
  onEditorDestroy: () => void;
};

let dragState: DragState | null = null;

function toggleSubtreeChecked(
  editor: Editor,
  pos: number,
  checked: boolean,
): void {
  const { tr } = editor.state;
  const node = tr.doc.nodeAt(pos);
  if (!node || node.type.name !== "taskItem") return;

  tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });

  node.descendants((child, childPos) => {
    if (child.type.name === "taskItem") {
      const absPos = pos + 1 + childPos;
      tr.setNodeMarkup(absPos, undefined, { ...child.attrs, checked });
    }
  });

  editor.view.dispatch(tr);
}

function getItemLevel(doc: ProseMirrorNode, pos: number): number {
  const $pos = doc.resolve(pos);
  let level = 0;
  for (let d = 0; d <= $pos.depth; d++) {
    if ($pos.node(d).type.name === "taskList") level++;
  }
  return level;
}

function collectTaskItems(editor: Editor): TaskItemInfo[] {
  const items: TaskItemInfo[] = [];
  const { doc } = editor.state;
  doc.descendants((node, pos) => {
    if (node.type.name !== "taskItem") return;
    const level = getItemLevel(doc, pos);
    const dom = editor.view.nodeDOM(pos);
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
  editor: Editor,
  items: TaskItemInfo[],
  level: number,
): number {
  const sameLevel = items.find((i) => i.level === level);
  if (sameLevel) return sameLevel.labelX;
  const lev1 = items.find((i) => i.level === 1);
  const lev2 = items.find((i) => i.level === 2);
  const editorRect = editor.view.dom.getBoundingClientRect();
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
  // Pin the indicator to the top of the item it will land before — this reads
  // clearly as "drop above this item" rather than floating in a midpoint
  // between rows (which can visually overlap the next item's row).
  return items[slot].label.getBoundingClientRect().top;
}

function positionIndicator(state: DragState, editor: Editor) {
  const y = slotY(state.items, state.slot);
  const x = levelXFor(editor, state.items, state.targetLevel);
  const editorRect = editor.view.dom.getBoundingClientRect();
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
  doc: ProseMirrorNode,
  pos: number,
  nodeSize: number,
): { from: number; to: number } {
  let from = pos;
  let to = pos + nodeSize;
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const parent = $pos.node(depth);
    if (parent.type.name !== "taskList") break;
    if (parent.childCount !== 1) break;
    from = $pos.before(depth);
    to = $pos.after(depth);
  }
  return { from, to };
}

function applyDrop(state: DragState) {
  const {
    editor,
    sourcePos,
    sourceNodeSize,
    sourceLevel,
    sourceIdx,
    items,
    slot,
    targetLevel,
  } = state;
  const { doc } = editor.state;

  const sourceNode = doc.nodeAt(sourcePos);
  if (!sourceNode || sourceNode.type.name !== "taskItem") return;

  const isNoMove = slot === sourceIdx || slot === sourceIdx + 1;
  let startLevel: number;

  if (isNoMove) {
    startLevel = sourceLevel;
    const tr = editor.state.tr;
    tr.setSelection(TextSelection.near(tr.doc.resolve(sourcePos + 1)));
    editor.view.dispatch(tr);
  } else {
    let insertAt: number;
    if (slot < items.length) {
      const next = items[slot];
      insertAt = next.pos;
      startLevel = next.level;
    } else {
      // Insert at end of the outermost taskList containing the last item.
      const last = items[items.length - 1];
      const $last = doc.resolve(last.pos);
      let outerListDepth = -1;
      for (let depth = $last.depth; depth >= 1; depth--) {
        if ($last.node(depth).type.name === "taskList") outerListDepth = depth;
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

    const tr = editor.state.tr;
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
    editor.view.dispatch(tr);
  }

  const steps = targetLevel - startLevel;
  for (let i = 0; i < Math.abs(steps); i++) {
    if (steps > 0) editor.commands.sinkListItem("taskItem");
    else editor.commands.liftListItem("taskItem");
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
  state.editor.off("destroy", state.onEditorDestroy);

  if (commit && state.active) {
    try {
      applyDrop(state);
    } catch {
      // Editor may have been torn down mid-drop; swallow to keep cleanup clean.
    }
  }
}

export const TaskItemDraggable = TaskItem.extend({
  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const listItem = document.createElement("li");
      const handleWrapper = document.createElement("div");
      const checkboxWrapper = document.createElement("label");
      const checkboxStyler = document.createElement("span");
      const checkbox = document.createElement("input");
      const content = document.createElement("div");
      content.className = "task-item-content";

      handleWrapper.contentEditable = "false";
      handleWrapper.className =
        "task-item-drag-handle text-black/40 dark:text-white/40 cursor-grab active:cursor-grabbing";
      handleWrapper.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
      handleWrapper.setAttribute("aria-label", "Drag to reorder");

      checkboxWrapper.contentEditable = "false";
      checkbox.type = "checkbox";
      checkbox.addEventListener("mousedown", (event) => event.preventDefault());
      checkbox.addEventListener("change", (event) => {
        if (!editor.isEditable && !this.options.onReadOnlyChecked) {
          checkbox.checked = !checkbox.checked;
          return;
        }

        const { checked } = event.target as HTMLInputElement;

        if (editor.isEditable && typeof getPos === "function") {
          const position = getPos();
          if (typeof position !== "number") return;
          toggleSubtreeChecked(editor, position, checked);
        }
        if (!editor.isEditable && this.options.onReadOnlyChecked) {
          if (
            !this.options.onReadOnlyChecked(node, checked) ||
            typeof getPos !== "function"
          ) {
            checkbox.checked = !checkbox.checked;
            return;
          }
          const position = getPos();
          if (typeof position !== "number") return;
          toggleSubtreeChecked(editor, position, checked);
        }
      });

      handleWrapper.addEventListener("pointerdown", (e: PointerEvent) => {
        if (!editor.isEditable) return;
        if (e.button !== 0) return;
        const pos = typeof getPos === "function" ? (getPos() ?? -1) : -1;
        if (pos < 0) return;

        e.stopPropagation();
        e.preventDefault();

        const allItems = collectTaskItems(editor);
        const sourceRaw = allItems.find((i) => i.pos === pos);
        if (!sourceRaw) return;
        // Drop targets exclude source's descendants — they move with source.
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
        const onEditorDestroy = () => endDrag(false);

        dragState = {
          editor,
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
          onEditorDestroy,
        };

        document.addEventListener("pointermove", onMove, true);
        document.addEventListener("pointerup", onUp, true);
        document.addEventListener("pointercancel", onCancel, true);
        document.addEventListener("keydown", onKeyDown, true);
        editor.on("destroy", onEditorDestroy);

        try {
          handleWrapper.setPointerCapture(e.pointerId);
        } catch {
          // setPointerCapture is best-effort; document-level listeners are the
          // actual source of pointermove/up events during the drag.
        }
      });

      // Suppress the native HTML5 drag that a draggable ancestor (e.g. the note
      // card) would otherwise start when the user mousedowns on the handle.
      handleWrapper.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
      });
      handleWrapper.addEventListener("dragstart", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      Object.entries(this.options.HTMLAttributes).forEach(([key, value]) => {
        listItem.setAttribute(key, value);
      });

      listItem.dataset.checked = node.attrs.checked;
      checkbox.checked = node.attrs.checked;

      checkboxWrapper.append(checkbox, checkboxStyler);
      listItem.append(handleWrapper, checkboxWrapper, content);

      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        listItem.setAttribute(key, value);
      });

      let prevRenderedAttributeKeys = new Set(Object.keys(HTMLAttributes));

      const syncHandleVisibility = () => {
        handleWrapper.style.display = editor.isEditable ? "" : "none";
      };
      syncHandleVisibility();

      return {
        dom: listItem,
        contentDOM: content,
        stopEvent: (event: Event) => {
          const target = event.target as HTMLElement;
          if (handleWrapper.contains(target)) return true;
          if (checkboxWrapper.contains(target)) return true;
          return false;
        },
        ignoreMutation: (mutation) => {
          // We mutate listItem's class (task-item-dragging) during drag and
          // mutate handle/checkbox subtrees as pure UI chrome. Let ProseMirror
          // ignore these so it doesn't tear down and rebuild the node view
          // mid-drag (which would detach sourceDom and kill the drag).
          if (mutation.type === "selection") return false;
          if (mutation.target === listItem && mutation.type === "attributes") {
            return true;
          }
          const target = mutation.target as Node;
          if (handleWrapper.contains(target)) return true;
          if (checkboxWrapper.contains(target)) return true;
          return false;
        },
        update: (updatedNode) => {
          if (updatedNode.type !== this.type) return false;

          listItem.dataset.checked = updatedNode.attrs.checked;
          checkbox.checked = updatedNode.attrs.checked;
          syncHandleVisibility();

          const extensionAttributes = editor.extensionManager.attributes;
          const newHTMLAttributes = getRenderedAttributes(
            updatedNode,
            extensionAttributes,
          );
          const newKeys = new Set(Object.keys(newHTMLAttributes));
          const staticAttrs = this.options.HTMLAttributes;

          prevRenderedAttributeKeys.forEach((key) => {
            if (!newKeys.has(key)) {
              if (key in staticAttrs) {
                listItem.setAttribute(key, staticAttrs[key]);
              } else {
                listItem.removeAttribute(key);
              }
            }
          });

          Object.entries(newHTMLAttributes).forEach(([key, value]) => {
            if (value === null || value === undefined) {
              if (key in staticAttrs) {
                listItem.setAttribute(key, staticAttrs[key]);
              } else {
                listItem.removeAttribute(key);
              }
            } else {
              listItem.setAttribute(key, value);
            }
          });

          prevRenderedAttributeKeys = newKeys;
          return true;
        },
      };
    };
  },
});

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
  positionIndicator(dragState, dragState.editor);
}
