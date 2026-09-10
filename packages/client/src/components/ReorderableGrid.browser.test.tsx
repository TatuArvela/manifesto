import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editingNoteId, notes, viewMode } from "../state/index.js";
import "../styles.css";

/**
 * `NoteGrid` and `AutoNotesView` each had their own masonry pass and their own
 * drag-and-drop, and the copies had drifted: the auto-notes grid never got the
 * touch path at all, so a plugin's notes could only be reordered with a mouse,
 * and its layout effect carried no dependency array, so every card in the view
 * was re-measured on every render.
 *
 * `matchMedia` decides which of the two drag paths `NoteCard` wires up, so it
 * is stubbed before the module is imported.
 */

const hoverNone = { current: false };
const realMatchMedia = window.matchMedia.bind(window);

vi.stubGlobal("matchMedia", (query: string) => {
  if (query === "(hover: none)") {
    return {
      matches: hoverNone.current,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    } as unknown as MediaQueryList;
  }
  return realMatchMedia(query);
});

const { isContainerVertical, ReorderableGrid } = await import(
  "./ReorderableGrid.js"
);

function makeNote(id: string, title: string, position: number): Note {
  return {
    id,
    title,
    content: `${title} body`,
    color: NoteColor.Default,
    font: NoteFont.Default,
    pinned: false,
    archived: false,
    trashed: false,
    trashedAt: null,
    position,
    tags: [],
    images: [],
    linkPreviews: [],
    reminder: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const three = [
  makeNote("01JQZK8V000000000000GRIDA", "Alpha", 0),
  makeNote("01JQZK8V000000000000GRIDB", "Bravo", 1),
  makeNote("01JQZK8V000000000000GRIDC", "Charlie", 2),
];

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  // Real geometry: the cards have to have boxes for a drop position to be
  // computed from one.
  host.style.width = "900px";
  document.body.appendChild(host);
  hoverNone.current = false;
  viewMode.value = "grid";
  notes.value = three;
  editingNoteId.value = null;
});

afterEach(() => {
  render(null, host);
  host.remove();
  notes.value = [];
  document.body.classList.remove("note-drag-active");
});

/**
 * The grid's own children — the wrappers, not the articles inside them. These
 * are the boxes the drop position is measured against.
 */
function cards(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(".note-draggable-wrapper")];
}

/** Centre of a card, in client coordinates. */
function centreOf(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  return {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
}

/** A point in a card's trailing half — a drop *after* it, either way round. */
function afterEdgeOf(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  return {
    clientX: rect.left + rect.width * 0.9,
    clientY: rect.top + rect.height * 0.9,
  };
}

/**
 * A drop position is state, set while the pointer moves and read when it is
 * released, so each phase of a drag has to reach the next one through a
 * render — which in a browser it always does, phases being frames apart.
 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The draggable element inside a wrapper — the card the handlers sit on. */
function articleIn(wrapper: HTMLElement): HTMLElement {
  const article = wrapper.querySelector("article");
  if (!article) throw new Error("no card in this wrapper");
  return article;
}

async function mouseDrag(
  wrapper: HTMLElement,
  to: { clientX: number; clientY: number },
) {
  const from = articleIn(wrapper);
  const dataTransfer = new DataTransfer();
  const grid = host.querySelector('[role="list"]');
  if (!grid) throw new Error("no grid");
  from.dispatchEvent(
    new DragEvent("dragstart", {
      bubbles: true,
      dataTransfer,
      ...centreOf(from),
    }),
  );
  await tick();
  grid.dispatchEvent(
    new DragEvent("dragover", { bubbles: true, dataTransfer, ...to }),
  );
  await tick();
  grid.dispatchEvent(
    new DragEvent("drop", { bubbles: true, dataTransfer, ...to }),
  );
  from.dispatchEvent(
    new DragEvent("dragend", { bubbles: true, dataTransfer, ...to }),
  );
  await tick();
}

async function touchDrag(
  wrapper: HTMLElement,
  to: { clientX: number; clientY: number },
) {
  const from = articleIn(wrapper);
  const opts = { bubbles: true, pointerId: 1, pointerType: "touch" as const };
  from.dispatchEvent(
    new PointerEvent("pointerdown", { ...opts, ...centreOf(from) }),
  );
  await tick();
  from.dispatchEvent(new PointerEvent("pointermove", { ...opts, ...to }));
  await tick();
  from.dispatchEvent(new PointerEvent("pointerup", { ...opts, ...to }));
  await tick();
}

describe("ReorderableGrid", () => {
  it("reorders on a mouse drag", async () => {
    const onReorder = vi.fn();
    render(
      <ReorderableGrid notes={three} reorderable onReorder={onReorder} />,
      host,
    );

    await mouseDrag(cards()[0], afterEdgeOf(cards()[2]));

    expect(onReorder).toHaveBeenCalledWith(
      three.map((n) => n.id),
      0,
      2,
    );
  });

  it("reorders on a touch drag, which the auto-notes grid never had", async () => {
    hoverNone.current = true;
    const onReorder = vi.fn();
    render(
      <ReorderableGrid notes={three} reorderable onReorder={onReorder} />,
      host,
    );

    await touchDrag(cards()[0], afterEdgeOf(cards()[2]));

    expect(onReorder).toHaveBeenCalledWith(
      three.map((n) => n.id),
      0,
      2,
    );
  });

  it("does not reorder a card dropped where it already is", async () => {
    const onReorder = vi.fn();
    render(
      <ReorderableGrid notes={three} reorderable onReorder={onReorder} />,
      host,
    );

    await mouseDrag(cards()[1], centreOf(cards()[1]));

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("does not drag at all when reordering is off", async () => {
    const onReorder = vi.fn();
    render(
      <ReorderableGrid
        notes={three}
        reorderable={false}
        onReorder={onReorder}
      />,
      host,
    );

    await mouseDrag(cards()[0], afterEdgeOf(cards()[2]));

    expect(onReorder).not.toHaveBeenCalled();
    expect(document.body.classList.contains("note-drag-active")).toBe(false);
  });

  it("spans every card for masonry, and re-spans when the notes change", () => {
    render(
      <ReorderableGrid notes={three} reorderable onReorder={() => {}} />,
      host,
    );
    const spans = () => cards().map((el) => el.style.gridRowEnd);
    expect(spans()).toHaveLength(3);
    for (const span of spans()) expect(span).toMatch(/^span \d+$/);

    const four = [...three, makeNote("01JQZK8V000000000000GRIDD", "Delta", 3)];
    notes.value = four;
    render(
      <ReorderableGrid notes={four} reorderable onReorder={() => {}} />,
      host,
    );
    expect(spans()).toHaveLength(4);
    for (const span of spans()) expect(span).toMatch(/^span \d+$/);
  });

  it("reads the drop position across columns, not down the page", async () => {
    // The grid is multi-column here, so "after Alpha" is the gap to its right
    // — a card directly below it is a different column's neighbour, not the
    // next position. Deciding this from the view mode instead of measuring
    // the container, which is what the auto-notes grid did, reads a drop
    // beside a card as a drop several places away.
    const onReorder = vi.fn();
    render(
      <ReorderableGrid notes={three} reorderable onReorder={onReorder} />,
      host,
    );
    const grid = host.querySelector<HTMLElement>('[role="list"]');
    expect(getComputedStyle(grid as HTMLElement).display).toBe("grid");

    await mouseDrag(cards()[2], afterEdgeOf(cards()[0]));

    expect(onReorder).toHaveBeenCalledWith(
      three.map((n) => n.id),
      2,
      1,
    );
  });

  it("lays the list view out without masonry spans", () => {
    viewMode.value = "list";
    render(
      <ReorderableGrid notes={three} reorderable onReorder={() => {}} />,
      host,
    );
    for (const card of cards()) {
      expect(card.style.gridRowEnd).toBe("");
    }
    viewMode.value = "grid";
  });
});

describe("isContainerVertical", () => {
  /** A container with this inline style, measured for real. */
  const verticalityOf = (style: string): boolean => {
    const el = document.createElement("div");
    el.setAttribute("style", style);
    document.body.appendChild(el);
    const vertical = isContainerVertical(el);
    el.remove();
    return vertical;
  };

  it("calls a flex column vertical — the list view", () => {
    expect(verticalityOf("display: flex; flex-direction: column")).toBe(true);
  });

  it("calls a single-column grid vertical", () => {
    // The reason this is measured rather than read off the view mode: the
    // masonry grid is one column at narrow widths too, and there a drop rule
    // goes between cards rather than beside one.
    expect(verticalityOf("display: grid; grid-template-columns: 1fr")).toBe(
      true,
    );
  });

  it("calls a multi-column grid horizontal", () => {
    expect(
      verticalityOf("display: grid; grid-template-columns: 1fr 1fr 1fr"),
    ).toBe(false);
  });
});
