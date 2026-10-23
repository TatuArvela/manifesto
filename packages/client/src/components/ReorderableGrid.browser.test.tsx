import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { options, render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notes } from "#/state/notesStore.ts";
import { noteSize, viewMode } from "#/state/prefs.ts";
import { editingNoteId, selectedNotes, selectMode } from "#/state/ui.ts";
import { defined } from "#/test/defined.ts";
import "#/styles.css";

/**
 * `NoteGrid` and `AutoNotesView` each had their own masonry pass and their own
 * drag-and-drop, and the copies became different. The auto-notes grid never got
 * the touch path. Thus, you could reorder the notes of a plugin only with a
 * mouse. Its layout effect had no dependency array. Thus, each card in the view
 * was measured again on each render.
 *
 * `matchMedia` decides which of the two drag paths `NoteCard` connects. Thus,
 * the test stubs it before it imports the module.
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

const { ReorderableGrid } = await import("./ReorderableGrid.tsx");
const { moveInto } = await import("#/hooks/useReorderDrag.ts");

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
  // Real geometry: the cards must have boxes, so that the code can calculate a
  // drop position from one.
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
 * The own children of the grid: the wrappers, not the articles inside them. The
 * code measures the drop position against these boxes.
 */
function cards(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(".note-draggable-wrapper")];
}

function card(i: number): HTMLElement {
  return defined(cards()[i], `card ${i}`);
}

/** The center of a card, in client coordinates. */
function centreOf(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  return {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
}

/**
 * A point in the trailing half of a card: a drop *after* it, in both
 * directions.
 */
function afterEdgeOf(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  return {
    clientX: rect.left + rect.width * 0.9,
    clientY: rect.top + rect.height * 0.9,
  };
}

/**
 * A drop position is state. The code sets it while the pointer moves, and reads
 * it at the release. Thus, each phase of a drag must reach the next phase
 * through a render. In a browser it always does, because the phases are frames
 * apart.
 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A frame and a render: how long a move under the pointer takes to show. */
const nextFrame = async () => {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await tick();
};

/**
 * The draggable element inside a wrapper: the card on which the handlers are.
 */
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
  // A drop commits the order on the screen, which a move reaches on the next
  // frame. The events of a browser are frames apart anyway.
  await nextFrame();
  grid.dispatchEvent(
    new DragEvent("drop", { bubbles: true, dataTransfer, ...to }),
  );
  from.dispatchEvent(
    new DragEvent("dragend", { bubbles: true, dataTransfer, ...to }),
  );
  await tick();
}

/**
 * The default hold of `useTouchGesture`, plus sufficient time for the timer to
 * run.
 */
const HOLD_MS = 500;

/**
 * A finger on a card. `hold` is the full gesture contract. A press that waits
 * picks up the card, and can drag it. A press that moves immediately is a
 * scroll, and must not change the card.
 */
async function touchDrag(
  wrapper: HTMLElement,
  to: { clientX: number; clientY: number },
  { hold = true }: { hold?: boolean } = {},
) {
  const from = articleIn(wrapper);
  const opts = { bubbles: true, pointerId: 1, pointerType: "touch" as const };
  from.dispatchEvent(
    new PointerEvent("pointerdown", { ...opts, ...centreOf(from) }),
  );
  await new Promise((resolve) => setTimeout(resolve, hold ? HOLD_MS : 0));
  from.dispatchEvent(new PointerEvent("pointermove", { ...opts, ...to }));
  await nextFrame();
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

    await mouseDrag(card(0), afterEdgeOf(card(2)));

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

    await touchDrag(card(0), afterEdgeOf(card(2)));

    expect(onReorder).toHaveBeenCalledWith(
      three.map((n) => n.id),
      0,
      2,
    );
  });

  it("leaves a card alone when the finger moves before holding it", async () => {
    hoverNone.current = true;
    const onReorder = vi.fn();
    render(
      <ReorderableGrid notes={three} reorderable onReorder={onReorder} />,
      host,
    );

    await touchDrag(card(0), afterEdgeOf(card(2)), { hold: false });

    // The swipe belonged to the page. The card was never picked up. Thus, it
    // never dimmed during the swipe, and nothing changed order behind it.
    expect(onReorder).not.toHaveBeenCalled();
    expect(articleIn(card(0)).classList.contains("note-dragging")).toBe(false);
    expect(document.body.classList.contains("note-drag-active")).toBe(false);
  });

  it("does not reorder a card dropped where it already is", async () => {
    const onReorder = vi.fn();
    render(
      <ReorderableGrid notes={three} reorderable onReorder={onReorder} />,
      host,
    );

    await mouseDrag(card(1), centreOf(card(1)));

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

    await mouseDrag(card(0), afterEdgeOf(card(2)));

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

  it("takes the place of the card it is dragged over, across a row", async () => {
    // The grid has many columns here. Charlie dropped on Bravo, next to it in
    // the row, goes to the position of Bravo. The code finds it from where the
    // cards are drawn, and does not guess it from the view mode.
    const onReorder = vi.fn();
    render(
      <ReorderableGrid notes={three} reorderable onReorder={onReorder} />,
      host,
    );
    const grid = host.querySelector<HTMLElement>('[role="list"]');
    expect(getComputedStyle(grid as HTMLElement).display).toBe("grid");

    await mouseDrag(card(2), centreOf(card(1)));

    expect(onReorder).toHaveBeenCalledWith(
      three.map((n) => n.id),
      2,
      1,
    );
  });

  it("previews the new order while the drag is under way", async () => {
    // The dragged card stays in the position where it would drop, and the other
    // cards make space. No line marks the gap.
    render(
      <ReorderableGrid notes={three} reorderable onReorder={() => {}} />,
      host,
    );
    const [alpha, bravo, charlie] = [card(0), card(1), card(2)];
    const from = articleIn(alpha);
    const dataTransfer = new DataTransfer();
    from.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        dataTransfer,
        ...centreOf(from),
      }),
    );
    await tick();
    const alphaWas = alpha.getBoundingClientRect();
    const charlieWas = charlie.getBoundingClientRect();
    host.querySelector('[role="list"]')?.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        dataTransfer,
        ...centreOf(charlie),
      }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await tick();

    expect([alpha, bravo, charlie].map((c) => c?.style.order)).toEqual([
      "2",
      "0",
      "1",
    ]);
    // Settled where the preview puts them: Alpha where Charlie was.
    for (const card of cards()) {
      for (const shift of card.getAnimations()) shift.finish();
    }
    expect(alpha?.getBoundingClientRect().left).toBeCloseTo(charlieWas.left, 0);
    expect(bravo?.getBoundingClientRect().left).toBeCloseTo(alphaWas.left, 0);

    // Released outside the grid: nothing moves, and the preview goes back.
    from.dispatchEvent(
      new DragEvent("dragend", { bubbles: true, dataTransfer }),
    );
    await tick();
    expect(cards().map((c) => c.style.order)).toEqual(["", "", ""]);
  });

  it("follows a finger with a copy while the card holds its place unseen", async () => {
    hoverNone.current = true;
    render(
      <ReorderableGrid notes={three} reorderable onReorder={() => {}} />,
      host,
    );
    const from = articleIn(card(0));
    const opts = { bubbles: true, pointerId: 1, pointerType: "touch" as const };
    const start = centreOf(from);
    from.dispatchEvent(new PointerEvent("pointerdown", { ...opts, ...start }));
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    // The drag starts on the first move past the threshold, from there.
    const picked = { clientX: start.clientX + 20, clientY: start.clientY };
    from.dispatchEvent(new PointerEvent("pointermove", { ...opts, ...picked }));
    const to = centreOf(card(2));
    from.dispatchEvent(new PointerEvent("pointermove", { ...opts, ...to }));
    await nextFrame();

    const ghost = document.querySelector<HTMLElement>(".note-drag-ghost");
    expect(ghost?.textContent).toContain("Alpha");
    expect(ghost?.style.translate).toBe(
      `${to.clientX - picked.clientX}px ${to.clientY - picked.clientY}px`,
    );
    // It still uses its space in the grid, but is not drawn there.
    expect(getComputedStyle(from).visibility).toBe("hidden");
    expect(from.getBoundingClientRect().height).toBeGreaterThan(0);

    from.dispatchEvent(new PointerEvent("pointerup", { ...opts, ...to }));
    await tick();
    expect(document.querySelector(".note-drag-ghost")).toBeNull();
    expect(getComputedStyle(from).visibility).toBe("visible");
  });

  it("scrolls the board while a finger holds a card near its bottom edge", async () => {
    hoverNone.current = true;
    viewMode.value = "list";
    const scroller = document.createElement("div");
    scroller.style.height = "160px";
    scroller.style.overflowY = "auto";
    document.body.appendChild(scroller);
    scroller.appendChild(host);
    render(
      <ReorderableGrid notes={three} reorderable onReorder={() => {}} />,
      host,
    );
    const from = articleIn(card(0));
    const opts = { bubbles: true, pointerId: 1, pointerType: "touch" as const };
    const start = centreOf(from);
    from.dispatchEvent(new PointerEvent("pointerdown", { ...opts, ...start }));
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    const bottom = scroller.getBoundingClientRect().bottom;
    const edge = { clientX: start.clientX, clientY: bottom - 4 };
    from.dispatchEvent(new PointerEvent("pointermove", { ...opts, ...edge }));

    await vi.waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(20));

    from.dispatchEvent(new PointerEvent("pointerup", { ...opts, ...edge }));
    await tick();
    // When released, it stays where it was taken.
    const stopped = scroller.scrollTop;
    await nextFrame();
    await nextFrame();
    expect(scroller.scrollTop).toBe(stopped);
    render(null, host);
    scroller.remove();
  });

  it("does not flip back and forth under a pointer that has not moved", async () => {
    // Cards move under a pointer that does not move when the order changes. The
    // card that is now under it is not a new target until the pointer moves.
    const onReorder = vi.fn();
    render(
      <ReorderableGrid notes={three} reorderable onReorder={onReorder} />,
      host,
    );
    const from = articleIn(card(0));
    const grid = host.querySelector('[role="list"]') as HTMLElement;
    const dataTransfer = new DataTransfer();
    from.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        dataTransfer,
        ...centreOf(from),
      }),
    );
    await tick();
    const over = centreOf(card(1));
    for (let i = 0; i < 4; i++) {
      grid.dispatchEvent(
        new DragEvent("dragover", { bubbles: true, dataTransfer, ...over }),
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await tick();
    }
    grid.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer, ...over }),
    );
    from.dispatchEvent(
      new DragEvent("dragend", { bubbles: true, dataTransfer }),
    );
    await tick();
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(
      three.map((n) => n.id),
      0,
      1,
    );
  });

  it("re-spans a card that grows after it was first measured", async () => {
    // The height of a card is not stable when the code first measures it. An
    // image decodes after the frame that added it, and lazy attachments arrive
    // a full round trip later. If a card keeps the span that it had while it
    // was empty, the card below it draws *through* it. The note grid did that
    // with each note that had a picture.
    render(
      <ReorderableGrid notes={three} reorderable onReorder={() => {}} />,
      host,
    );
    const spanOf = (i: number) =>
      Number(/span (\d+)/.exec(card(i).style.gridRowEnd)?.[1] ?? 0);
    const before = spanOf(0);
    expect(before).toBeGreaterThan(0);

    const grown = document.createElement("div");
    grown.style.height = "400px";
    articleIn(card(0)).appendChild(grown);

    await vi.waitFor(() => {
      expect(spanOf(0)).toBeGreaterThan(before + 300);
    });
    // Also, the card below it moved down, and did not overlap it.
    expect(card(0).getBoundingClientRect().bottom).toBeLessThanOrEqual(
      card(0).getBoundingClientRect().top + spanOf(0),
    );
  });

  it("spans a card by its layout box, not the box its animation draws", () => {
    // The code measures a just-pinned card when it arrives, while its settle
    // animation scales it up and tilts it. When the measurement included the
    // transform, a square card got a span several percent taller than itself,
    // which stayed as a gap under it.
    noteSize.value = "square";
    try {
      render(
        <ReorderableGrid notes={three} reorderable onReorder={() => {}} />,
        host,
      );
      card(0).style.transform = "scale(1.045) rotate(-0.9deg)";
      render(
        <ReorderableGrid
          notes={[...three].reverse()}
          reorderable
          onReorder={() => {}}
        />,
        host,
      );
      const tilted = cards().find(
        (card) => card.style.transform !== "",
      ) as HTMLElement;
      expect(tilted.getBoundingClientRect().width).toBeGreaterThan(
        tilted.offsetWidth + 2,
      );
      expect(tilted.style.gridRowEnd).toBe(
        `span ${Math.ceil(tilted.offsetWidth + 16)}`,
      );
    } finally {
      noteSize.value = "fit";
    }
  });

  it("re-renders only the card a selection touches, and none for a drag", async () => {
    // Before, each card read the board-wide signals itself, and got a new
    // closure on each render. Thus, a selection of one note rendered again (and
    // parsed the markdown of) each card on the board.
    const rendered: string[] = [];
    const previous = options.diffed;
    options.diffed = (vnode) => {
      const type = vnode.type as { name?: string } | string;
      if (typeof type === "function" && type.name === "NoteCard") {
        rendered.push((vnode.props as unknown as { note: Note }).note.title);
      }
      previous?.(vnode);
    };
    try {
      selectMode.value = true;
      render(
        <ReorderableGrid notes={three} reorderable onReorder={() => {}} />,
        host,
      );
      // The grid measures its first card after it mounts, and gives the width
      // to all cards once. That render is not one of a selection.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await tick();
      rendered.length = 0;
      selectedNotes.value = new Set([defined(three[1]).id]);
      await tick();
      expect(rendered).toEqual(["Bravo"]);

      rendered.length = 0;
      const from = articleIn(card(0));
      const dataTransfer = new DataTransfer();
      from.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          dataTransfer,
          ...centreOf(from),
        }),
      );
      await tick();
      host.querySelector('[role="list"]')?.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          dataTransfer,
          ...afterEdgeOf(card(2)),
        }),
      );
      // The previewed order goes on the styles of the cards, not on their
      // props. Thus, a drag renders none of them again.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await tick();
      expect(rendered).toEqual([]);
      from.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    } finally {
      if (previous) options.diffed = previous;
      else delete options.diffed;
      selectedNotes.value = new Set();
      selectMode.value = false;
    }
  });

  it("re-spans only the card that grew, not its neighbours", async () => {
    // When one card changed, the release and new measurement of all cards
    // forced a layout of the full board each time a picture decoded, or an
    // auto-save changed the height of a note.
    render(
      <ReorderableGrid notes={three} reorderable onReorder={() => {}} />,
      host,
    );
    const spanOf = (i: number) =>
      Number(/span (\d+)/.exec(card(i).style.gridRowEnd)?.[1] ?? 0);
    // Let the first delivery of the observer pass before the test watches for
    // writes.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await tick();
    const touched = new Set<Node>();
    const watcher = new MutationObserver((records) => {
      for (const record of records) touched.add(record.target);
    });
    for (const card of cards()) {
      watcher.observe(card, { attributes: true, attributeFilter: ["style"] });
    }
    const before = spanOf(0);

    const grown = document.createElement("div");
    grown.style.height = "400px";
    articleIn(card(0)).appendChild(grown);

    await vi.waitFor(() => {
      expect(spanOf(0)).toBeGreaterThan(before + 300);
    });
    for (const record of watcher.takeRecords()) touched.add(record.target);
    watcher.disconnect();
    expect(touched.has(card(0))).toBe(true);
    expect(touched.has(card(1))).toBe(false);
    expect(touched.has(card(2))).toBe(false);
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

  it("stacks a section into one column in grid mode, and drags down it", async () => {
    const onReorder = vi.fn();
    render(
      <ReorderableGrid
        notes={three}
        reorderable
        onReorder={onReorder}
        stacked
      />,
      host,
    );
    const container = card(0).parentElement as HTMLElement;
    expect(getComputedStyle(container).flexDirection).toBe("column");
    for (const card of cards()) {
      expect(card.style.gridRowEnd).toBe("");
    }

    await mouseDrag(card(0), afterEdgeOf(card(2)));

    expect(onReorder).toHaveBeenCalledWith(
      three.map((n) => n.id),
      0,
      2,
    );
  });
});

describe("moveInto", () => {
  it("takes the target's place, from either side", () => {
    expect(moveInto(["a", "b", "c", "d"], "a", "c")).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
    expect(moveInto(["a", "b", "c", "d"], "d", "b")).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("changes nothing for itself or an unknown id", () => {
    expect(moveInto(["a", "b"], "a", "a")).toEqual(["a", "b"]);
    expect(moveInto(["a", "b"], "a", "z")).toEqual(["a", "b"]);
  });
});
