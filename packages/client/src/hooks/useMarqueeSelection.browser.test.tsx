import type { Note } from "@manifesto/shared";
import { render } from "preact";
import { useRef } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notes } from "../state/notesStore.js";
import { createNoteOrFail } from "../state/testSupport.js";
import {
  activeView,
  searchQuery,
  selectedNotes,
  selectMode,
} from "../state/ui.js";
import { useMarqueeSelection } from "./useMarqueeSelection.js";

function Grid({ ids }: { ids: string[] }) {
  const ref = useRef<HTMLElement>(null);
  useMarqueeSelection(ref);
  return (
    <main
      ref={ref}
      style={{ position: "fixed", inset: 0, overflow: "auto", padding: 50 }}
    >
      {ids.map((id, i) => (
        <div
          key={id}
          data-note-id={id}
          class="note-draggable-wrapper"
          style={{
            position: "absolute",
            left: `${100 + i * 150}px`,
            top: "100px",
            width: "100px",
            height: "100px",
          }}
        />
      ))}
    </main>
  );
}

function pointer(
  type: string,
  x: number,
  y: number,
  init: PointerEventInit = {},
) {
  const target =
    type === "pointerdown"
      ? (document.elementFromPoint(x, y) as Element)
      : document;
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: x,
      clientY: y,
      ...init,
    }),
  );
}

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

describe("useMarqueeSelection", () => {
  let host: HTMLDivElement;
  let created: Note[];

  beforeEach(async () => {
    localStorage.clear();
    notes.value = [];
    activeView.value = "active";
    searchQuery.value = "";
    selectedNotes.value = new Set();
    selectMode.value = false;
    created = [
      await createNoteOrFail({ title: "a" }),
      await createNoteOrFail({ title: "b" }),
      await createNoteOrFail({ title: "c" }),
    ];
    host = document.createElement("div");
    document.body.appendChild(host);
    render(<Grid ids={created.map((n) => n.id)} />, host);
    // Preact runs effects after paint, and the listener is attached in one.
    await frame();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  afterEach(() => {
    render(null, host);
    host.remove();
    localStorage.clear();
    selectedNotes.value = new Set();
    selectMode.value = false;
  });

  it("selects the cards a drag from empty space passes over", async () => {
    // Cards at x 100, 250, 400; the box runs from the gap left of the first
    // to the middle of the second.
    pointer("pointerdown", 70, 60);
    pointer("pointermove", 180, 150);
    pointer("pointermove", 300, 150);
    await frame();
    expect([...selectedNotes.value]).toEqual([created[0].id, created[1].id]);
    expect(selectMode.value).toBe(true);
    pointer("pointerup", 300, 150);
    expect(selectedNotes.value.size).toBe(2);
  });

  it("does not start on a card, which is a reorder drag instead", async () => {
    pointer("pointerdown", 150, 150);
    pointer("pointermove", 400, 150);
    await frame();
    expect(selectedNotes.value.size).toBe(0);
    pointer("pointerup", 400, 150);
  });

  it("clears the selection on a click on empty space", async () => {
    selectedNotes.value = new Set([created[2].id]);
    selectMode.value = true;
    pointer("pointerdown", 70, 60);
    pointer("pointermove", 72, 61);
    pointer("pointerup", 72, 61);
    expect(selectedNotes.value.size).toBe(0);
    expect(selectMode.value).toBe(false);
  });

  it("clears it on a tap too, but not when the touch scrolls", async () => {
    selectedNotes.value = new Set([created[2].id]);
    selectMode.value = true;
    const touch = { pointerType: "touch" };
    pointer("pointerdown", 70, 60, touch);
    pointer("pointermove", 70, 160, touch);
    pointer("pointercancel", 70, 160, touch);
    expect(selectedNotes.value.size).toBe(1);

    pointer("pointerdown", 70, 60, touch);
    pointer("pointerup", 70, 60, touch);
    expect(selectedNotes.value.size).toBe(0);
  });

  it("keeps the selection on a Shift-click on empty space", async () => {
    selectedNotes.value = new Set([created[2].id]);
    selectMode.value = true;
    pointer("pointerdown", 70, 60, { shiftKey: true });
    pointer("pointerup", 70, 60, { shiftKey: true });
    expect([...selectedNotes.value]).toEqual([created[2].id]);
  });

  it("keeps the selection on a click on a card", async () => {
    selectedNotes.value = new Set([created[2].id]);
    selectMode.value = true;
    pointer("pointerdown", 150, 150);
    pointer("pointerup", 150, 150);
    expect([...selectedNotes.value]).toEqual([created[2].id]);
  });

  it("adds to the selection with Shift held", async () => {
    selectedNotes.value = new Set([created[2].id]);
    selectMode.value = true;
    pointer("pointerdown", 70, 60, { shiftKey: true });
    pointer("pointermove", 180, 150);
    await frame();
    pointer("pointerup", 180, 150);
    expect(new Set(selectedNotes.value)).toEqual(
      new Set([created[2].id, created[0].id]),
    );
  });

  it("puts the earlier selection back on Escape", async () => {
    selectedNotes.value = new Set([created[2].id]);
    selectMode.value = true;
    pointer("pointerdown", 70, 60);
    pointer("pointermove", 180, 150);
    await frame();
    await vi.waitFor(() =>
      expect([...selectedNotes.value]).toEqual([created[0].id]),
    );
    // The Escape layer registers once the box has rendered.
    await frame();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect([...selectedNotes.value]).toEqual([created[2].id]);
    expect(selectMode.value).toBe(true);
    pointer("pointerup", 180, 150);
  });
});
