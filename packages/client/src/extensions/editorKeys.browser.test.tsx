import { type Editor, editorViewCtx } from "@milkdown/kit/core";
import { GapCursor } from "@milkdown/kit/prose/gapcursor";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  getEditorMarkdown,
  MilkdownEditor,
} from "#/components/editor/MilkdownEditor.tsx";
import "#/styles.css";

/**
 * The keys of the editor, really pushed. Which command a key reaches depends on
 * the keymap of each plugin and their order, which only a full editor has.
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

/**
 * Puts the caret just before the first `text` in the document, plus `offset`.
 */
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

describe("Backspace at the start of a block", () => {
  it("turns a heading of any level into a paragraph at once", async () => {
    const editor = await mount("### Title");
    caretAt(editor, "Title");
    await userEvent.keyboard("{Backspace}");
    expect(markdown(editor)).toBe("Title");
  });

  it("turns a code block into a paragraph, even first in the note", async () => {
    const editor = await mount("```\nlet x\n```");
    caretAt(editor, "let x");
    await userEvent.keyboard("{Backspace}");
    expect(markdown(editor)).toBe("let x");
  });
});

describe("Tab in a list or a table", () => {
  it("keeps focus on a list's first item, which cannot be indented", async () => {
    const editor = await mount("- [ ] Milk\n- [ ] Bread");
    caretAt(editor, "Milk");
    await userEvent.keyboard("{Tab}");
    expect(viewOf(editor).hasFocus()).toBe(true);
    expect(markdown(editor)).toBe("- [ ] Milk\n- [ ] Bread");
  });

  it("still indents an item that can be", async () => {
    const editor = await mount("- [ ] Milk\n- [ ] Bread");
    caretAt(editor, "Bread");
    await userEvent.keyboard("{Tab}");
    expect(markdown(editor)).toMatch(/^- \[ \] Milk\n +- \[ \] Bread$/);
  });

  it("adds a row from the last cell and stays in the table", async () => {
    const editor = await mount("| a | b |\n| - | - |\n| c | d |");
    caretAt(editor, "d");
    await userEvent.keyboard("{Tab}");
    const view = viewOf(editor);
    expect(view.hasFocus()).toBe(true);
    expect(view.state.doc.firstChild?.childCount).toBe(3);
    expect(view.state.selection.$from.node(-2)).toBe(
      view.state.doc.firstChild?.lastChild,
    );
  });

  it("keeps focus on Shift-Tab from the first cell", async () => {
    const editor = await mount("| a | b |\n| - | - |\n| c | d |");
    caretAt(editor, "a");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(viewOf(editor).hasFocus()).toBe(true);
  });

  it("leaves Tab in a plain paragraph to the browser", async () => {
    const editor = await mount("Text");
    caretAt(editor, "Text");
    await userEvent.keyboard("{Tab}");
    expect(viewOf(editor).hasFocus()).toBe(false);
  });
});

describe("spaces in the text", () => {
  it("are laid out as typed, so a trailing one moves the caret", async () => {
    // ProseMirror needs this, and its stylesheet never loaded. With `normal`, a
    // space at the end of a line used no space.
    const editor = await mount("Text");
    const dom = viewOf(editor).dom;
    expect(getComputedStyle(dom).whiteSpace).toMatch(
      /^(pre-wrap|break-spaces)$/,
    );
    caretAt(editor, "Text", 4);
    const before = viewOf(editor).coordsAtPos(5).left;
    await userEvent.keyboard(" ");
    const after = viewOf(editor).coordsAtPos(6).left;
    expect(after).toBeGreaterThan(before);
  });
});

describe("arrows at either end of the note", () => {
  it("reach the gap after a table that ends the note, and type there", async () => {
    const editor = await mount("| a | b |\n| - | - |\n| c | d |");
    caretAt(editor, "d", 1);
    await userEvent.keyboard("{ArrowDown}");
    expect(viewOf(editor).state.selection).toBeInstanceOf(GapCursor);
    await userEvent.keyboard("after");
    expect(markdown(editor)).toMatch(/\| c \| d \|\n\nafter$/);
  });

  it("reach the gap before a divider that starts the note", async () => {
    const editor = await mount("---\n\nText");
    caretAt(editor, "Text");
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(viewOf(editor).state.selection).toBeInstanceOf(GapCursor);
  });

  it("leave a code block that ends the note for a new paragraph", async () => {
    const editor = await mount("```\nlet x\n```");
    caretAt(editor, "let x", 5);
    await userEvent.keyboard("{ArrowDown}after");
    expect(markdown(editor)).toBe("```\nlet x\n```\n\nafter");
  });

  it("leave a code block that starts the note for a new paragraph", async () => {
    const editor = await mount("```\nlet x\n```");
    caretAt(editor, "let x");
    await userEvent.keyboard("{ArrowLeft}before");
    expect(markdown(editor)).toBe("before\n\n```\nlet x\n```");
  });

  it("move through a code block with text after it as before", async () => {
    const editor = await mount("```\nlet x\n```\n\nText");
    caretAt(editor, "let x", 5);
    await userEvent.keyboard("{ArrowDown}");
    expect(viewOf(editor).state.selection.$from.parent.textContent).toBe(
      "Text",
    );
  });
});
