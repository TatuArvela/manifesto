import { liftListItem, sinkListItem } from "@milkdown/kit/prose/schema-list";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { edgeScroll, scrollParent } from "../utils/edgeScroll.js";
import {
  endOfOuterList,
  getDeletionRange,
  getItemLevel,
  getOuterListPos,
  isTaskItem,
} from "./taskListStructure.js";

// Dragging a checklist item by its handle: a pointer-driven drag (not HTML5
// drag and drop) that moves the item and its subtree, and indents or outdents
// it by how far sideways it is dropped. One drag at a time, held in module
// state, since there is only one pointer doing it.

const INDENT_PX = 24;
const DRAG_THRESHOLD_PX = 4;
const INDICATOR_HEIGHT_PX = 2;

type TaskItemInfo = {
  pos: number;
  nodeSize: number;
  level: number;
  outerListPos: number;
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
  atListEnd: boolean;
  targetLevel: number;
  indicator: HTMLElement;
  /** The item under the finger, drawn at the level it would land on. */
  ghost: HTMLElement | null;
  /** Where in the item the pointer took hold of it. */
  grabOffsetY: number;
  sourceLabelOffsetX: number;
  lastX: number;
  lastY: number;
  scroller: HTMLElement;
  scrollFrame: number;
  onMove: (e: PointerEvent) => void;
  onUp: (e: PointerEvent) => void;
  onCancel: (e: PointerEvent) => void;
  onKeyDown: (e: KeyboardEvent) => void;
};

let dragState: DragState | null = null;

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
      outerListPos: getOuterListPos(view.state.doc, pos),
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

function effectiveNeighborIdx(
  slot: number,
  sourceIdx: number,
  side: "above" | "below",
): number {
  if (side === "above") {
    let idx = slot - 1;
    if (idx === sourceIdx) idx--;
    return idx;
  }
  let idx = slot;
  if (idx === sourceIdx) idx++;
  return idx;
}

function computeAtListEnd(
  items: TaskItemInfo[],
  slot: number,
  sourceIdx: number,
  clientY: number,
): boolean {
  const aboveIdx = effectiveNeighborIdx(slot, sourceIdx, "above");
  const belowIdx = effectiveNeighborIdx(slot, sourceIdx, "below");
  if (aboveIdx < 0 || belowIdx >= items.length) return false;
  const above = items[aboveIdx];
  const below = items[belowIdx];
  if (above.outerListPos < 0 || below.outerListPos < 0) return false;
  if (above.outerListPos === below.outerListPos) return false;
  const aboveBottom = above.dom.getBoundingClientRect().bottom;
  const belowTop = below.label.getBoundingClientRect().top;
  return clientY < (aboveBottom + belowTop) / 2;
}

function computeTargetLevel(
  items: TaskItemInfo[],
  slot: number,
  sourceIdx: number,
  sourceLevel: number,
  deltaX: number,
  atListEnd: boolean,
): number {
  const aboveIdx = effectiveNeighborIdx(slot, sourceIdx, "above");
  const above = aboveIdx >= 0 ? items[aboveIdx] : null;

  const belowIdx = effectiveNeighborIdx(slot, sourceIdx, "below");
  const below = !atListEnd && belowIdx < items.length ? items[belowIdx] : null;

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

function slotY(
  items: TaskItemInfo[],
  slot: number,
  sourceIdx: number,
  atListEnd: boolean,
): number {
  if (items.length === 0) return 0;
  if (atListEnd) {
    const aboveIdx = effectiveNeighborIdx(slot, sourceIdx, "above");
    const ref = items[aboveIdx];
    if (ref)
      return Math.max(
        ref.label.getBoundingClientRect().bottom,
        ref.dom.getBoundingClientRect().bottom,
      );
  }
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
  const y = slotY(state.items, state.slot, state.sourceIdx, state.atListEnd);
  const x = levelXFor(state.view, state.items, state.targetLevel);
  const editorRect = state.view.dom.getBoundingClientRect();
  state.indicator.style.top = `${y - INDICATOR_HEIGHT_PX / 2}px`;
  state.indicator.style.left = `${x}px`;
  state.indicator.style.width = `${Math.max(editorRect.right - x - 4, 40)}px`;
}

/**
 * A copy of the dragged item that follows the pointer and snaps sideways to
 * the level it would be dropped at. The line alone says where; on a touch
 * screen the finger sits on it, and a shift of one indent in a two-pixel line
 * was all that told a nested drop from a flat one.
 *
 * The copy is wrapped in the editor's own class so the task-row rules still
 * draw it, and takes the note's font from the item itself, since it lives in
 * `document.body`, outside the note.
 */
function createGhost(source: HTMLElement): HTMLElement {
  const style = getComputedStyle(source);
  const wrapper = document.createElement("div");
  wrapper.className = "milkdown-editor task-item-drag-ghost";
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.style.font = style.font;
  wrapper.style.color = style.color;
  wrapper.style.width = `${source.getBoundingClientRect().width}px`;
  const list = document.createElement("ul");
  const copy = source.cloneNode(true) as HTMLElement;
  copy.classList.remove("task-item-dragging", "task-item-active");
  // Its handles and X buttons are not controls, and would only clutter.
  for (const control of copy.querySelectorAll(
    ".task-item-drag-handle, .task-item-delete",
  ))
    control.remove();
  list.appendChild(copy);
  wrapper.appendChild(list);
  return wrapper;
}

function positionGhost(state: DragState) {
  if (!state.ghost) return;
  const x = levelXFor(state.view, state.items, state.targetLevel);
  state.ghost.style.left = `${x - state.sourceLabelOffsetX}px`;
  state.ghost.style.top = `${state.lastY - state.grabOffsetY}px`;
}

/**
 * Scrolls while the pointer rests near an edge of the scrolling area, and
 * re-aims the drop as the list moves under it. Runs every frame of a drag;
 * the item positions are read live, so nothing collected at the start goes
 * stale.
 */
function autoScroll() {
  const state = dragState;
  if (!state) return;
  state.scrollFrame = requestAnimationFrame(autoScroll);
  if (state.active && edgeScroll(state.scroller, state.lastY)) aim(state);
}

function createIndicator(): HTMLElement {
  const el = document.createElement("div");
  el.className = "task-item-drop-indicator";
  return el;
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
    atListEnd,
    targetLevel,
  } = state;
  const doc = view.state.doc;

  const sourceNode = doc.nodeAt(sourcePos);
  if (!sourceNode || !isTaskItem(sourceNode)) return;

  let insertAt: number;
  let startLevel: number;
  if (atListEnd) {
    const aboveIdx = effectiveNeighborIdx(slot, sourceIdx, "above");
    const above = aboveIdx >= 0 ? items[aboveIdx] : null;
    if (!above) return;
    const end = endOfOuterList(doc, above.pos);
    if (end < 0) return;
    insertAt = end;
    startLevel = 1;
  } else if (slot < items.length) {
    const next = items[slot];
    insertAt = next.pos;
    startLevel = next.level;
  } else {
    const last = items[items.length - 1];
    const end = endOfOuterList(doc, last.pos);
    if (end < 0) return;
    insertAt = end;
    startLevel = 1;
  }

  const isNoMove =
    insertAt === sourcePos || insertAt === sourcePos + sourceNodeSize;

  if (isNoMove) {
    startLevel = sourceLevel;
    const tr = view.state.tr;
    tr.setSelection(TextSelection.near(tr.doc.resolve(sourcePos + 1)));
    view.dispatch(tr);
  } else {
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

  cancelAnimationFrame(state.scrollFrame);
  state.sourceDom.classList.remove("task-item-dragging");
  state.indicator.remove();
  state.ghost?.remove();
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

  dragState.lastX = e.clientX;
  dragState.lastY = e.clientY;

  if (!dragState.active) {
    if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    dragState.active = true;
    dragState.ghost = createGhost(dragState.sourceDom);
    document.body.appendChild(dragState.ghost);
    dragState.sourceDom.classList.add("task-item-dragging");
  }

  aim(dragState);
}

/** Works out where the pointer would drop the item, and shows it. */
function aim(state: DragState) {
  state.slot = findSlot(state.items, state.lastY);
  state.atListEnd = computeAtListEnd(
    state.items,
    state.slot,
    state.sourceIdx,
    state.lastY,
  );
  state.targetLevel = computeTargetLevel(
    state.items,
    state.slot,
    state.sourceIdx,
    state.sourceLevel,
    state.lastX - state.startX,
    state.atListEnd,
  );
  positionIndicator(state);
  positionGhost(state);
}

/**
 * Starts a drag of the task item at `pos`, whose node view is `listItem`,
 * from a press on its handle. The drag is live until the pointer is released
 * (drop), cancelled, or Escape is pressed.
 */
export function startTaskItemDrag(
  view: EditorView,
  listItem: HTMLElement,
  handle: HTMLElement,
  pos: number,
  e: PointerEvent,
): void {
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
  const sourceRect = listItem.getBoundingClientRect();

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
    atListEnd: false,
    targetLevel: source.level,
    indicator,
    ghost: null,
    grabOffsetY: e.clientY - sourceRect.top,
    sourceLabelOffsetX: source.labelX - sourceRect.left,
    lastX: e.clientX,
    lastY: e.clientY,
    scroller: scrollParent(listItem),
    scrollFrame: 0,
    onMove,
    onUp,
    onCancel,
    onKeyDown,
  };

  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerup", onUp, true);
  document.addEventListener("pointercancel", onCancel, true);
  document.addEventListener("keydown", onKeyDown, true);
  dragState.scrollFrame = requestAnimationFrame(autoScroll);

  try {
    handle.setPointerCapture(e.pointerId);
  } catch {
    // setPointerCapture is best-effort; document-level listeners drive the drag.
  }
}

/** Abandons the drag if it is of this item, as its node view goes away. */
export function endTaskItemDragOf(listItem: HTMLElement): void {
  if (dragState && dragState.sourceDom === listItem) endDrag(false);
}
