import { type Editor, editorViewCtx } from "@milkdown/kit/core";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MilkdownEditor } from "../components/MilkdownEditor.js";
import { docHasDatedItems, sortItemsByDateIn } from "./itemDates.js";
import "../styles.css";

let host: HTMLDivElement;
let markdown = "";
const held: { editor: Editor | null } = { editor: null };

async function mount(content: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  render(
    <MilkdownEditor
      content={content}
      onChange={(value) => {
        markdown = value;
      }}
      onEditorReady={(ready) => {
        held.editor = ready;
      }}
    />,
    host,
  );
  await vi.waitFor(() => {
    expect(held.editor).not.toBeNull();
    expect(host.querySelector("li[data-item-type=task]")).not.toBeNull();
  });
}

function view() {
  if (!held.editor) throw new Error("no editor");
  return held.editor.action((ctx) => ctx.get(editorViewCtx));
}
const chips = () => [...host.querySelectorAll<HTMLElement>(".item-date")];

afterEach(() => {
  render(null, host);
  host.remove();
  held.editor = null;
  markdown = "";
});

describe("dates on checklist items in the editor", () => {
  it("draws the token as a chip, overdue only on an open item in the past", async () => {
    await mount(
      [
        "- [ ] late @2000-01-01",
        "- [x] done @2000-01-01",
        "- [ ] far off @2999-01-01",
        "- [ ] quoted `@2000-01-01`",
        "- plain @2000-01-01",
      ].join("\n"),
    );

    expect(chips().map((chip) => chip.textContent)).toEqual([
      "@2000-01-01",
      "@2000-01-01",
      "@2999-01-01",
    ]);
    expect(
      chips().map((chip) => chip.classList.contains("item-date-overdue")),
    ).toEqual([true, false, false]);
    expect(docHasDatedItems(view().state.doc)).toBe(true);
  });

  it("leaves the token as text in the Markdown", async () => {
    const content = "- [ ] late @2000-01-01";
    await mount(content);
    view().dispatch(
      view().state.tr.insertText("5", view().state.doc.content.size - 3),
    );
    await vi.waitFor(() => expect(markdown).toContain("@2000-01-015"));
    // No longer a date, so no longer a chip.
    expect(chips()).toHaveLength(0);
  });

  it("sorts items by date among their siblings, children moving with them", async () => {
    await mount(
      [
        "- [ ] none",
        "- [ ] b @2026-11-01",
        "  - [ ] b2 @2026-11-09",
        "  - [ ] b1 @2026-11-02",
        "- [x] a @2026-10-01",
      ].join("\n"),
    );

    sortItemsByDateIn(view());

    await vi.waitFor(() =>
      expect(markdown.trim().split("\n")).toEqual([
        "- [x] a @2026-10-01",
        "- [ ] b @2026-11-01",
        "  - [ ] b1 @2026-11-02",
        "  - [ ] b2 @2026-11-09",
        "- [ ] none",
      ]),
    );
  });

  it("dispatches nothing when the items are already in order", async () => {
    await mount("- [ ] a @2026-10-01\n- [ ] none");
    const before = view().state.doc;
    sortItemsByDateIn(view());
    expect(view().state.doc).toBe(before);
  });
});
