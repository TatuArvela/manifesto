import type { Editor } from "@milkdown/kit/core";
import { createRef, render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormattingToolbar } from "./FormattingToolbar.js";
import { MilkdownEditor } from "./MilkdownEditor.js";

const hosts: HTMLDivElement[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

describe("FormattingToolbar in raw mode", () => {
  it("formats the textarea's text, not the hidden rich editor", async () => {
    // Raw mode keeps the rich editor mounted behind the textarea. The toolbar
    // used to go on driving it, so Bold lit up and changed a document nobody
    // could see, which was then overwritten on the way back to rich mode.
    const host = document.createElement("div");
    document.body.appendChild(host);
    hosts.push(host);

    const textareaRef = createRef<HTMLTextAreaElement>();
    let editor: Editor | null = null;
    render(
      <MilkdownEditor
        content="one two"
        onChange={() => {}}
        rawMode
        textareaRef={textareaRef}
        onEditorReady={(e) => {
          editor = e;
        }}
      />,
      host,
    );
    await vi.waitFor(() => expect(editor).not.toBeNull());
    const textarea = textareaRef.current as HTMLTextAreaElement;

    const toolbarHost = document.createElement("div");
    document.body.appendChild(toolbarHost);
    hosts.push(toolbarHost);
    render(
      <FormattingToolbar
        editor={editor as unknown as Editor}
        rawTextarea={textarea}
        tick={0}
      />,
      toolbarHost,
    );

    textarea.focus();
    textarea.setSelectionRange(5, 5);
    (
      toolbarHost.querySelector('button[aria-label="Bold"]') as HTMLElement
    ).click();

    await vi.waitFor(() => expect(textarea.value).toBe("one **two**"));
    expect(host.querySelector(".ProseMirror")?.innerHTML).not.toContain(
      "<strong>",
    );
  });
});
