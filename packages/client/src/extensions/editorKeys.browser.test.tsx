import { type Editor, editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  getEditorMarkdown,
  MilkdownEditor,
} from "../components/MilkdownEditor.js";
import "../styles.css";

/**
 * The editor's keys, pressed for real: which command a key reaches depends on
 * every plugin's keymap and their order, which only a whole editor has.
 */

const hosts: HTMLDivElement[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

async function mount(content: string): Promise<Editor> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
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

const viewOf = (editor: Editor): EditorView =>
  editor.action((ctx) => ctx.get(editorViewCtx));

/** Puts the caret just before the first `text` in the document, plus `offset`. */
function caretAt(editor: Editor, text: string, offset = 0) {
  const view = viewOf(editor);
  let found = -1;
  view.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    const at = node.isText ? (node.text ?? "").indexOf(text) : -1;
    if (at !== -1) found = pos + at;
    return true;
  });
  if (found === -1) throw new Error(`no "${text}" in the document`);
  view.focus();
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, found + offset),
    ),
  );
}

const markdown = (editor: Editor) => getEditorMarkdown(editor).trim();

describe("Delete at the start of a block", () => {
  it("deletes the next character of a list item, not the item", async () => {
    const editor = await mount("- [ ] Milk\n- [ ] Bread");
    caretAt(editor, "Bread");
    await userEvent.keyboard("{Delete}");
    expect(markdown(editor)).toBe("- [ ] Milk\n- [ ] read");
  });

  it("deletes the next character of a heading, not its level", async () => {
    const editor = await mount("## Title");
    caretAt(editor, "Title");
    await userEvent.keyboard("{Delete}");
    expect(markdown(editor)).toBe("## itle");
  });
});
