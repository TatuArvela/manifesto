import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMarkdown, tiptapExtensions } from "../components/TiptapEditor.js";

let editor: Editor;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  host.className = "tiptap-editor";
  host.style.cssText = "font-size: 14px; width: 600px; padding: 20px;";
  document.body.appendChild(host);
});

afterEach(() => {
  editor?.destroy();
  host.remove();
  document.querySelectorAll(".task-item-drop-indicator").forEach((el) => {
    el.remove();
  });
});

function makeEditor(content: string) {
  editor = new Editor({
    element: host,
    extensions: tiptapExtensions,
    content,
  });
}

function dispatchPointer(
  target: EventTarget,
  type: string,
  clientX: number,
  clientY: number,
  pointerId = 1,
) {
  const ev = new PointerEvent(type, {
    pointerId,
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 0,
    pointerType: "mouse",
  });
  target.dispatchEvent(ev);
}

function handleOf(li: Element) {
  return li.querySelector(".task-item-drag-handle") as HTMLElement;
}

describe("TaskItemDraggable pointer drag", () => {
  it("moves a task item after another when dragged vertically", () => {
    makeEditor("- [ ] A\n- [ ] B\n- [ ] C");

    const items = Array.from(
      host.querySelectorAll("li[data-checked]"),
    ) as HTMLLIElement[];
    const handleA = handleOf(items[0]);
    const rectA = handleA.getBoundingClientRect();
    const rectC = items[2].getBoundingClientRect();

    dispatchPointer(
      handleA,
      "pointerdown",
      rectA.left + 4,
      rectA.top + rectA.height / 2,
    );
    dispatchPointer(
      document,
      "pointermove",
      rectA.left + 20,
      rectA.top + rectA.height / 2,
    );
    dispatchPointer(document, "pointermove", rectA.left + 4, rectC.bottom + 2);
    dispatchPointer(document, "pointerup", rectA.left + 4, rectC.bottom + 2);

    expect(getMarkdown(editor).trim()).toBe("- [ ] B\n- [ ] C\n- [ ] A");
  });

  it("indents an item (nesting level +1) when dragged right onto the previous item", () => {
    makeEditor("- [ ] A\n- [ ] B");

    const items = Array.from(
      host.querySelectorAll("li[data-checked]"),
    ) as HTMLLIElement[];
    const handleB = handleOf(items[1]);
    const rectB = handleB.getBoundingClientRect();

    // Drag B to the right ~30px, hovering at B's own slot (between A and B)
    dispatchPointer(
      handleB,
      "pointerdown",
      rectB.left + 4,
      rectB.top + rectB.height / 2,
    );
    const rectBLi = items[1].getBoundingClientRect();
    // Move into B's top half (so slot = index 1, right after A) + 30px right
    dispatchPointer(document, "pointermove", rectB.left + 40, rectBLi.top + 2);
    dispatchPointer(document, "pointerup", rectB.left + 40, rectBLi.top + 2);

    // B should be nested under A
    expect(getMarkdown(editor).trim()).toBe("- [ ] A\n  - [ ] B");
  });

  it("outdents an item (nesting level -1) when dragged left", () => {
    makeEditor("- [ ] A\n  - [ ] B");

    const items = Array.from(
      host.querySelectorAll("li[data-checked]"),
    ) as HTMLLIElement[];
    expect(items).toHaveLength(2);
    const handleB = handleOf(items[1]);
    const rectB = handleB.getBoundingClientRect();
    const rectBLi = items[1].getBoundingClientRect();

    // Drag B to the left ~30px, stay at its own slot
    dispatchPointer(
      handleB,
      "pointerdown",
      rectB.left + 4,
      rectB.top + rectB.height / 2,
    );
    dispatchPointer(document, "pointermove", rectB.left - 40, rectBLi.top + 2);
    dispatchPointer(document, "pointerup", rectB.left - 40, rectBLi.top + 2);

    expect(getMarkdown(editor).trim()).toBe("- [ ] A\n- [ ] B");
  });

  it("shows a drop indicator while dragging", () => {
    makeEditor("- [ ] A\n- [ ] B");

    const items = Array.from(
      host.querySelectorAll("li[data-checked]"),
    ) as HTMLLIElement[];
    const handleA = handleOf(items[0]);
    const rectA = handleA.getBoundingClientRect();

    dispatchPointer(
      handleA,
      "pointerdown",
      rectA.left + 4,
      rectA.top + rectA.height / 2,
    );
    dispatchPointer(
      document,
      "pointermove",
      rectA.left + 20,
      rectA.top + rectA.height / 2,
    );

    const indicator = document.querySelector(".task-item-drop-indicator");
    expect(indicator).toBeTruthy();

    dispatchPointer(
      document,
      "pointerup",
      rectA.left + 20,
      rectA.top + rectA.height / 2,
    );

    expect(document.querySelector(".task-item-drop-indicator")).toBeNull();
  });

  it("indents a nested item in place when cursor stays on source and drags right", () => {
    // Three items at level 1, then a fourth item nested under an earlier
    // parent with its own subtree — previously the parent's <li> rect swallowed
    // the cursor into the parent's slot, breaking in-place indent.
    makeEditor("- [ ] A\n  - [ ] A1\n  - [ ] A2\n- [ ] B");

    const items = Array.from(
      host.querySelectorAll("li[data-checked]"),
    ) as HTMLLIElement[];
    // A2 is the third li; we want to indent A2 under A1 without moving it.
    const a2 = items[2];
    const handleA2 = handleOf(a2);
    const rectA2 = handleA2.getBoundingClientRect();
    const labelA2 = a2.querySelector("label") as HTMLElement;
    const labelRect = labelA2.getBoundingClientRect();

    dispatchPointer(
      handleA2,
      "pointerdown",
      rectA2.left + 4,
      labelRect.top + labelRect.height / 2,
    );
    // Drag right ~30px while keeping Y on A2's label row — no move, just indent.
    dispatchPointer(
      document,
      "pointermove",
      rectA2.left + 30,
      labelRect.top + labelRect.height / 2,
    );
    dispatchPointer(
      document,
      "pointerup",
      rectA2.left + 30,
      labelRect.top + labelRect.height / 2,
    );

    expect(getMarkdown(editor).trim()).toBe(
      "- [ ] A\n  - [ ] A1\n    - [ ] A2\n- [ ] B",
    );
  });

  it("moves an item past a parent with a subtree when dropping below the parent's own row", () => {
    // A1 should be movable past A's subtree sibling boundary by dropping just
    // below the next sibling's checkbox row (not its whole subtree).
    makeEditor("- [ ] A\n- [ ] B\n  - [ ] B1\n  - [ ] B2");

    const items = Array.from(
      host.querySelectorAll("li[data-checked]"),
    ) as HTMLLIElement[];
    // Drag A down past B's own label row (but above B's children).
    const a = items[0];
    const handleA = handleOf(a);
    const rectA = handleA.getBoundingClientRect();
    const labelB = items[1].querySelector("label") as HTMLElement;
    const labelBRect = labelB.getBoundingClientRect();

    dispatchPointer(
      handleA,
      "pointerdown",
      rectA.left + 4,
      rectA.top + rectA.height / 2,
    );
    // Move below B's label row midpoint → slot past B, before B1.
    dispatchPointer(
      document,
      "pointermove",
      rectA.left + 4,
      labelBRect.bottom + 1,
    );
    dispatchPointer(
      document,
      "pointerup",
      rectA.left + 4,
      labelBRect.bottom + 1,
    );

    // A should now sit between B and B1 (as a nested child of B).
    expect(getMarkdown(editor).trim()).toBe(
      "- [ ] B\n  - [ ] A\n  - [ ] B1\n  - [ ] B2",
    );
  });
});
