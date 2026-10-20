import { liftListItem, sinkListItem } from "@milkdown/kit/prose/schema-list";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { edgeScroll, scrollParent } from "#/utils/edgeScroll.ts";
import {
  dropLevel,
  INDENT_PX,
  listBoundaryAt,
  neighborIndex,
  slotAt,
  touchLift,
} from "./taskItemDropTarget.ts";
import {
  endOfOuterList,
  getDeletionRange,
  getItemLevel,
  getOuterListPos,
  isTaskItem,
} from "./taskListStructure.ts";

// A drag of a checklist item by its handle: a drag that the pointer controls
// (not HTML5 drag and drop). It moves the item and its subtree, and indents or
// outdents it by how far to the side it is dropped. One drag at a time, kept in
// module state, because only one pointer does it.

const DRAG_THRESHOLD_PX = 4;
const INDICATOR_HEIGHT_PX = 2;

type TaskItemInfo = {
  pos: number;
  nodeSize: number;
  level: number;
  outerListPos: number;
  dom: HTMLElement;
  label: HTMLElement;
  /**
   * The own line of the item, its first paragraph, without the items under it.
   */
  line: HTMLElement;
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
  /** The item under the finger, drawn at the level where it would go. */
  ghost: HTMLElement | null;
  /**
   * The point of the held item at the aim: where the pointer took it, or, for a
   * finger, the middle of its line.
   */
  grabOffsetY: number;
  /** If the pointer is a finger, whose aim is above it. */
  touch: boolean;
  /** How far above the pointer the drop aims now. It only grows. */
  lift: number;
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
    const line =
      dom.querySelector<HTMLElement>(
        ":scope > .task-item-content > :first-child",
      ) ?? label;
    items.push({
      pos,
      nodeSize: node.nodeSize,
      level,
      outerListPos: getOuterListPos(view.state.doc, pos),
      dom,
      label,
      line,
      labelX: labelRect.left,
    });
  });
  return items;
}

/**
 * Measured on the full line, not on the checkbox. A box at the top of a long
 * item put the middle of the item in the slot after it.
 */
function findSlot(items: TaskItemInfo[], y: number): number {
  return slotAt(
    items.length,
    (i) => {
      const rect = items[i]?.line.getBoundingClientRect();
      return rect ? rect.top + rect.height / 2 : Number.POSITIVE_INFINITY;
    },
    y,
  );
}

function computeAtListEnd(
  items: TaskItemInfo[],
  slot: number,
  sourceIdx: number,
  clientY: number,
): boolean {
  const boundary = listBoundaryAt(items, slot, sourceIdx);
  if (!boundary) return false;
  const aboveBottom = boundary.above.dom.getBoundingClientRect().bottom;
  const belowTop = boundary.below.label.getBoundingClientRect().top;
  return clientY < (aboveBottom + belowTop) / 2;
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
    const ref = items[neighborIndex(slot, sourceIdx, "above")];
    if (ref)
      return Math.max(
        ref.label.getBoundingClientRect().bottom,
        ref.dom.getBoundingClientRect().bottom,
      );
  }
  const next = items[slot];
  if (next) return next.label.getBoundingClientRect().top;
  const last = items.at(-1);
  if (!last) return 0;
  return Math.max(
    last.label.getBoundingClientRect().bottom,
    last.dom.getBoundingClientRect().bottom,
  );
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
 * A copy of the dragged item that follows the pointer, and snaps to the side to
 * the level where it would drop. The line alone tells where. On a touch screen,
 * the finger is on it, and a shift of one indent in a two-pixel line was the
 * only sign of a nested drop or a flat drop.
 *
 * The copy is wrapped in the own class of the editor. Thus, the task-row rules
 * still draw it. It gets the font of the note from the item itself, because it
 * is in `document.body`, outside the note.
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
  // Its handles and X buttons are not controls, and would only add clutter.
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
  state.ghost.style.top = `${aimY(state) - state.grabOffsetY}px`;
}

/**
 * Scrolls while the pointer stays near an edge of the scrolling area, and aims
 * the drop again when the list moves under it. Runs on each frame of a drag.
 * The code reads the positions of the items live. Thus, nothing collected at
 * the start becomes stale.
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
  const next = items[slot];
  const last = items.at(-1);
  if (atListEnd) {
    const aboveIdx = neighborIndex(slot, sourceIdx, "above");
    const above = aboveIdx >= 0 ? items[aboveIdx] : null;
    if (!above) return;
    const end = endOfOuterList(doc, above.pos);
    if (end < 0) return;
    insertAt = end;
    startLevel = 1;
  } else if (next) {
    insertAt = next.pos;
    startLevel = next.level;
  } else {
    if (!last) return;
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
      // The view can be torn down during the drop. Ignore the error, to keep
      // the cleanup clean.
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
  updateLift(dragState);

  if (!dragState.active) {
    if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    dragState.active = true;
    dragState.ghost = createGhost(dragState.sourceDom);
    document.body.appendChild(dragState.ghost);
    dragState.sourceDom.classList.add("task-item-dragging");
  }

  aim(dragState);
}

/** The height at which the drop aims: the pointer, or above a finger. */
function aimY(state: DragState): number {
  return state.lastY - state.lift;
}

function updateLift(state: DragState) {
  if (!state.touch) return;
  state.lift = touchLift(state.lift, state.lastY - state.startY);
}

/** Calculates where the pointer would drop the item, and shows it. */
function aim(state: DragState) {
  const y = aimY(state);
  state.slot = findSlot(state.items, y);
  state.atListEnd = computeAtListEnd(
    state.items,
    state.slot,
    state.sourceIdx,
    y,
  );
  state.targetLevel = dropLevel(
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
 * Starts a drag of the task item at `pos`, whose node view is `listItem`, from
 * a press on its handle. The drag is live until the pointer releases (drop), a
 * cancel occurs, or you push Escape.
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
  const source = items[sourceIdx];
  if (!source) return;

  const indicator = createIndicator();
  document.body.appendChild(indicator);
  const sourceRect = listItem.getBoundingClientRect();
  const touch = e.pointerType === "touch";
  const lineRect = source.line.getBoundingClientRect();

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
    if (ev.key !== "Escape") return;
    // The press belongs to the drag. It is heard first (capture), and kept from
    // the listener of the Escape stack, which would also close the note under
    // the drag.
    ev.preventDefault();
    ev.stopPropagation();
    endDrag(false);
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
    grabOffsetY: touch
      ? (lineRect.top + lineRect.bottom) / 2 - sourceRect.top
      : e.clientY - sourceRect.top,
    touch,
    lift: 0,
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
    // setPointerCapture is best effort. Document-level listeners control the
    // drag.
  }
}

/** Abandons the drag if it is of this item, when its node view goes away. */
export function endTaskItemDragOf(listItem: HTMLElement): void {
  if (dragState && dragState.sourceDom === listItem) endDrag(false);
}
