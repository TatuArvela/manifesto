import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentPreview } from "./ContentPreview.js";

/**
 * What a card actually shows. The pieces below it — the checklist parser, the
 * segmenter, the renderer — have their own tests; these are the four ways the
 * preview used to disagree with the note it was drawing.
 */

let host: HTMLDivElement;

const FENCE = "```";

function noteWith(content: string): Note {
  return {
    id: "01JQZK8V00000000000PREVIEW",
    title: "",
    content,
    color: NoteColor.Default,
    font: NoteFont.Default,
    pinned: false,
    archived: false,
    trashed: false,
    trashedAt: null,
    position: 0,
    tags: [],
    images: [],
    linkPreviews: [],
    reminder: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function show(content: string, onToggle: (line: number) => void = () => {}) {
  render(
    <ContentPreview
      note={noteWith(content)}
      onCheckboxToggle={onToggle}
      hasTitle={false}
    />,
    host,
  );
}

const boxes = () => [...host.querySelectorAll('input[type="checkbox"]')];

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe("ContentPreview", () => {
  it("renders markdown in a checklist label", () => {
    // Labels were printed as plain text, so `**milk**` showed its asterisks
    // while the same words one line below rendered bold.
    show("- [ ] Buy **milk**");

    expect(host.querySelector("strong")?.textContent).toBe("milk");
    expect(host.textContent).not.toContain("**");
  });

  it("keeps a checkbox for an item with no label", () => {
    // Pressing Enter in the editor makes one of these. It used to stop being
    // a checklist line the moment it was created: the box disappeared and the
    // literal `- [ ]` was left as text, with nothing to click to bring it
    // back.
    show("- [ ] Something\n- [ ]");

    expect(boxes()).toHaveLength(2);
    expect(host.textContent).not.toContain("[ ]");
  });

  it("toggles the line the box belongs to, empty label included", () => {
    const onToggle = vi.fn();
    show("- [ ] Something\n- [ ]", onToggle);

    (boxes()[1] as HTMLInputElement).click();

    expect(onToggle).toHaveBeenCalledWith(1);
  });

  it("leaves checklist syntax inside a code block as code", () => {
    // A note documenting our own syntax had the block cut in half, with the
    // middle drawn as live checkboxes.
    show(["Syntax:", FENCE, "- [ ] todo", "- [x] done", FENCE].join("\n"));

    expect(boxes()).toHaveLength(0);
    expect(host.querySelector("pre")?.textContent).toContain("- [ ] todo");
  });

  it("still draws boxes for checklists outside the block", () => {
    show(["- [ ] real", FENCE, "- [ ] fake", FENCE].join("\n"));

    expect(boxes()).toHaveLength(1);
    expect(host.querySelector("pre")?.textContent).toContain("- [ ] fake");
  });

  it("keeps the toolbar's own tags", () => {
    // `<u>`, `<sub>` and `<sup>` sat in the sanitizer's allowlist while
    // remark-rehype dropped them before it was ever asked.
    show("plain <u>underlined</u> text");

    expect(host.querySelector("u")?.textContent).toBe("underlined");
  });

  it("checks the box for a completed item and strikes its label", () => {
    show("- [x] Done **already**");

    expect((boxes()[0] as HTMLInputElement).checked).toBe(true);
    expect(host.querySelector(".line-through")?.textContent).toBe(
      "Done already",
    );
  });
});
