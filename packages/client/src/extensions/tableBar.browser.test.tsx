import { type Editor, editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { MilkdownEditor } from "#/components/editor/MilkdownEditor.tsx";
import { t } from "#/i18n/index.ts";
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

const bar = () => host.querySelector<HTMLElement>(".table-bar");

describe("the bar over a table", () => {
  it("shows while the caret is in a table, and only then", async () => {
    const editor = await mount("Text\n\n| a | b |\n| - | - |\n| c | d |");
    caretAt(editor, "c");
    await vi.waitFor(() => expect(bar()?.dataset.open).toBe("true"));
    caretAt(editor, "Text");
    await vi.waitFor(() => expect(bar()?.dataset.open).toBe("false"));
  });

  it("adds a row from its button and keeps the caret in the table", async () => {
    const editor = await mount("| a | b |\n| - | - |\n| c | d |");
    const view = caretAt(editor, "c");
    await page.getByRole("button", { name: t("format.tableAddRow") }).click();
    expect(view.state.doc.firstChild?.childCount).toBe(3);
    expect(view.hasFocus()).toBe(true);
    expect(bar()?.dataset.open).toBe("true");
  });

  it("disables what would leave a table Markdown cannot write", async () => {
    const editor = await mount("| a | b |\n| - | - |\n| c | d |");
    caretAt(editor, "a");
    await vi.waitFor(() => expect(bar()?.dataset.open).toBe("true"));
    const button = (name: string) =>
      host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
    expect(button(t("format.tableDeleteRow"))?.disabled).toBe(true);
    expect(button(t("format.tableDeleteColumn"))?.disabled).toBe(false);
  });
});
