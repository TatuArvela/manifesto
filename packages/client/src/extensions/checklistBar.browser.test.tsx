import { type Editor, editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MilkdownEditor } from "#/components/editor/MilkdownEditor.js";
import { t } from "#/i18n/index.js";
import "#/styles.css";

let host: HTMLDivElement;

afterEach(() => {
  render(null, host);
  host.remove();
});

async function mount(content: string): Promise<Editor> {
  host = document.createElement("div");
  document.body.appendChild(host);
  let ready: Editor | null = null;
  render(
    <MilkdownEditor
      content={content}
      onChange={() => {}}
      onEditorReady={(editor) => {
        ready = editor;
      }}
    />,
    host,
  );
  await vi.waitFor(() => expect(ready).not.toBeNull());
  return ready as unknown as Editor;
}

/** Focuses the editor with the caret just before the first `text`. */
function caretAt(editor: Editor, text: string) {
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  let found = -1;
  view.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText) {
      const at = (node.text ?? "").indexOf(text);
      if (at !== -1) found = pos + at;
    }
    return found === -1;
  });
  view.focus();
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, found)),
  );
  return view;
}

const bar = () => host.querySelector<HTMLElement>(".checklist-bar");
const picker = () =>
  host.querySelector<HTMLInputElement>(".checklist-bar-picker");

describe("the bar over a checklist item", () => {
  it("shows while the caret is in a checklist item, and only then", async () => {
    const editor = await mount("Text\n\n- [ ] Milk");
    caretAt(editor, "Milk");
    await vi.waitFor(() => expect(bar()?.dataset.open).toBe("true"));
    caretAt(editor, "Text");
    await vi.waitFor(() => expect(bar()?.dataset.open).toBe("false"));
  });

  it("writes the picked date into the item and keeps the caret there", async () => {
    const editor = await mount("- [ ] Milk");
    const view = caretAt(editor, "Milk");
    await vi.waitFor(() => expect(bar()?.dataset.open).toBe("true"));
    const input = picker();
    if (!input) throw new Error("no picker");
    input.value = "2026-10-02";
    input.dispatchEvent(new Event("change"));
    expect(view.state.doc.textContent).toBe("Milk @2026-10-02");
    expect(view.hasFocus()).toBe(true);
  });

  it("is one button, named by whether the item has a date", async () => {
    const editor = await mount("- [ ] Milk @2026-10-02\n- [ ] Eggs");
    caretAt(editor, "Eggs");
    await vi.waitFor(() => expect(bar()?.dataset.open).toBe("true"));
    const buttons = () => bar()?.querySelectorAll("button") ?? [];
    expect(buttons().length).toBe(1);
    expect(bar()?.textContent).toBe("");
    expect(buttons()[0]?.getAttribute("aria-label")).toBe(t("editor.itemDate"));
    caretAt(editor, "Milk");
    await vi.waitFor(() =>
      expect(buttons()[0]?.getAttribute("aria-label")).toBe(
        t("editor.itemDateChange"),
      ),
    );
  });
});
