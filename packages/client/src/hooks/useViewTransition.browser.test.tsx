import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { animations } from "#/state/prefs.js";
import { activeTag, activeView } from "#/state/ui.js";
import { defined } from "#/test/defined.js";
import { usePaneSlide, useViewTransition } from "./useViewTransition.js";

let host: HTMLDivElement;

// Each view's notes, in order: `b` is on both boards, a place further up on
// the second, `a` only on the first and `c` only on the second.
const BOARDS: Record<string, string[]> = {
  active: ["a", "b"],
  search: ["b", "c"],
};

function Board() {
  const board = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useViewTransition(board, content);
  const view = activeView.value;
  return (
    <div style={{ position: "relative" }}>
      <main ref={board} style={{ height: "400px", overflowY: "auto" }}>
        <div ref={content} data-view>
          {view === "active" && (
            <div data-view-slide="composer" style={{ height: "60px" }} />
          )}
          <p id="label">{`${view}:${activeTag.value ?? ""}`}</p>
          {(BOARDS[view] ?? []).map((id) => (
            <div key={id} data-note-id={id} style={{ height: "50px" }} />
          ))}
        </div>
      </main>
    </div>
  );
}

const view = () => host.querySelector("[data-view]") as HTMLElement;
const label = () => view().querySelector("#label") as HTMLElement;
const card = (id: string) =>
  view().querySelector(`[data-note-id="${id}"]`) as HTMLElement;
const ghosts = () => Array.from(host.querySelectorAll<HTMLElement>("[inert]"));
const ghostCard = (ghost: HTMLElement | undefined, id: string) =>
  ghost?.querySelector<HTMLElement>(`[data-note-id="${id}"]`);

beforeEach(() => {
  activeView.value = "active";
  activeTag.value = null;
  animations.value = true;
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  activeView.value = "active";
  activeTag.value = null;
  animations.value = true;
  localStorage.clear();
});

describe("useViewTransition", () => {
  it("plays nothing on the first render", async () => {
    await act(() => render(<Board />, host));
    expect(card("b").getAnimations()).toHaveLength(0);
    expect(label().getAnimations()).toHaveLength(0);
    expect(ghosts()).toHaveLength(0);
  });

  it("moves a note on both boards and fades the rest across", async () => {
    await act(() => render(<Board />, host));
    await act(() => {
      activeView.value = "search";
    });
    expect(label().textContent).toBe("search:");
    // On both: it travels, at full strength, and its copy is hidden.
    const [move, ...more] = card("b").getAnimations();
    expect(more).toHaveLength(0);
    expect((move as Animation).id).toBe("view-move");
    // New to the board, and what is not a note: they fade in.
    expect(card("c").getAnimations()).toHaveLength(1);
    expect(label().getAnimations()).toHaveLength(1);
    const [ghost, ...rest] = ghosts();
    expect(rest).toHaveLength(0);
    expect(ghost?.querySelector("#label")).toBeNull();
    expect(ghost?.textContent).toBe("active:");
    expect(ghostCard(ghost, "b")?.style.visibility).toBe("hidden");
    expect(ghostCard(ghost, "a")?.style.visibility).toBe("");
    expect(ghost?.getAttribute("aria-hidden")).toBe("true");
    await vi.waitFor(() => expect(ghosts()).toHaveLength(0));
  });

  it("slides the new-note pad up as it leaves and down as it comes", async () => {
    await act(() => render(<Board />, host));
    await act(() => {
      activeView.value = "search";
    });
    const [ghost] = ghosts();
    expect(ghost?.dataset.sliding).toBe("true");
    await vi.waitFor(() => expect(ghosts()).toHaveLength(0));
    await act(() => {
      activeView.value = "active";
    });
    const pad = view().querySelector("[data-view-slide]") as HTMLElement;
    const [slide] = pad.getAnimations();
    const effect = defined(slide, "the pad's slide").effect as KeyframeEffect;
    const [start] = effect.getKeyframes();
    expect(start?.transform).toMatch(/^translateY\(-/);
  });

  it("plays again on a change of tag, giving way to the one before", async () => {
    await act(() => render(<Board />, host));
    await act(() => {
      activeView.value = "tags";
      activeTag.value = "work";
    });
    await act(() => {
      activeTag.value = "home";
    });
    expect(label().getAnimations()).toHaveLength(1);
    const [ghost, ...rest] = ghosts();
    expect(rest).toHaveLength(0);
    expect(ghost?.textContent).toBe("tags:work");
  });

  it("plays nothing with animations turned off", async () => {
    animations.value = false;
    await act(() => render(<Board />, host));
    await act(() => {
      activeView.value = "search";
    });
    expect(card("b").getAnimations()).toHaveLength(0);
    expect(label().getAnimations()).toHaveLength(0);
    expect(ghosts()).toHaveLength(0);
  });
});

function Shell({ open }: { open: boolean }) {
  const pane = useRef<HTMLElement>(null);
  const board = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  usePaneSlide(pane, board, content, open);
  return (
    <div style={{ display: "flex", width: "800px" }}>
      <aside ref={pane} data-pane style={{ width: "200px", flexShrink: 0 }} />
      <main ref={board} style={{ flex: 1, overflowY: "auto" }}>
        <div ref={content} data-view />
      </main>
    </div>
  );
}

const pane = () => host.querySelector("[data-pane]") as HTMLElement;

describe("usePaneSlide", () => {
  it("does not move on the first render", async () => {
    await act(() => render(<Shell open />, host));
    expect(pane().getAnimations()).toHaveLength(0);
  });

  it("holds the content at the width it ends at while the pane opens", async () => {
    await act(() => render(<Shell open={false} />, host));
    await act(() => render(<Shell open />, host));
    expect(pane().getAnimations()).toHaveLength(1);
    expect(view().style.width).toBe("600px");
    await vi.waitFor(() => expect(view().style.width).toBe(""));
  });

  it("holds the content at the whole width while the pane closes", async () => {
    await act(() => render(<Shell open />, host));
    await act(() => render(<Shell open={false} />, host));
    expect(view().style.width).toBe("800px");
    expect((host.querySelector("main") as HTMLElement).style.overflowX).toBe(
      "hidden",
    );
    await vi.waitFor(() => expect(view().style.width).toBe(""));
  });
});
