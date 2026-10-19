import { type Editor, editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { createRef, render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { t } from "#/i18n/index.ts";
import { FormattingToolbar } from "./FormattingToolbar.tsx";
import { MilkdownEditor } from "./MilkdownEditor.tsx";
// The real stylesheet: unstyled, a tooltip is a popover in the middle of the
// page that takes the click meant for the button under it.
import "#/styles.css";

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

describe("FormattingToolbar's floating bar", () => {
  // A wide screen's: a phone has these in the fold, and the default viewport
  // is a phone's width.
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  async function mountToolbar(content: string) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    hosts.push(host);
    let editor: Editor | null = null;
    render(
      <MilkdownEditor
        content={content}
        onChange={() => {}}
        onEditorReady={(e) => {
          editor = e;
        }}
      />,
      host,
    );
    await vi.waitFor(() => expect(editor).not.toBeNull());
    const toolbarHost = document.createElement("div");
    document.body.appendChild(toolbarHost);
    hosts.push(toolbarHost);
    render(
      <FormattingToolbar editor={editor as unknown as Editor} tick={0} />,
      toolbarHost,
    );
    const button = (label: string) =>
      toolbarHost.querySelector<HTMLButtonElement>(
        `button[aria-label="${label}"]`,
      );
    return {
      host,
      toolbarHost,
      button,
      editor: editor as unknown as Editor,
    };
  }

  /** Whether the bar's panel is open; it stays in the page while closed. */
  const barOpen = (toolbarHost: HTMLElement) =>
    toolbarHost
      .querySelector('[role="toolbar"]')
      ?.closest(".dropdown-panel")
      ?.getAttribute("data-open") === "true";

  it("opens from its button and stays open while it is used", async () => {
    const { host, toolbarHost, button } = await mountToolbar("Text");
    expect(barOpen(toolbarHost)).toBe(false);
    button(t("format.moreFormatting"))?.click();
    await vi.waitFor(() => expect(barOpen(toolbarHost)).toBe(true));
    button(t("format.quote"))?.click();
    await vi.waitFor(() =>
      expect(host.querySelector(".ProseMirror blockquote")).not.toBeNull(),
    );
    expect(barOpen(toolbarHost)).toBe(true);
    button(t("format.moreFormatting"))?.click();
    await vi.waitFor(() => expect(barOpen(toolbarHost)).toBe(false));
  });

  it("stays open when the text is clicked", async () => {
    const { host, toolbarHost, button } = await mountToolbar("Text");
    button(t("format.moreFormatting"))?.click();
    await vi.waitFor(() => expect(barOpen(toolbarHost)).toBe(true));
    host
      .querySelector(".ProseMirror")
      ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(barOpen(toolbarHost)).toBe(true);
  });

  it("takes a quote off with real clicks, not nesting it", async () => {
    // Reported twice from the app: Quote pressed in quoted text nested it.
    const note = [
      "- Ccc",
      "",
      "| a | b |",
      "| - | - |",
      "| c | d |",
      "",
      "```",
      "Aaa",
      "```",
      "",
      "> Bbb",
      "",
      "After",
    ].join("\n");
    const { host, editor } = await mountToolbar(note);
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      let at = -1;
      view.state.doc.descendants((node, pos) => {
        if (at === -1 && node.isText && node.text?.includes("Bbb")) at = pos;
        return at === -1;
      });
      view.focus();
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, at + 1),
        ),
      );
    });
    await page
      .getByRole("button", { name: t("format.moreFormatting") })
      .click();
    await page.getByRole("button", { name: t("format.quote") }).click();
    await vi.waitFor(() =>
      expect(host.querySelector(".ProseMirror blockquote")).toBeNull(),
    );
    await page.getByRole("button", { name: t("format.quote") }).click();
    await vi.waitFor(() =>
      expect(host.querySelectorAll(".ProseMirror blockquote")).toHaveLength(1),
    );
    expect(host.querySelector(".ProseMirror blockquote blockquote")).toBeNull();
  });

  it("is in the fold on a phone, which has no Escape to close the bar", async () => {
    await page.viewport(375, 700);
    const { toolbarHost } = await mountToolbar("Text");
    await expect
      .element(page.getByRole("button", { name: t("format.moreFormatting") }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: t("format.moreControls") }).click();
    const quote = page.getByRole("button", { name: t("format.quote") });
    await expect.element(quote).toBeVisible();
    expect(
      toolbarHost
        .querySelector(`button[aria-label="${t("format.quote")}"]`)
        ?.closest(".dropdown-panel"),
    ).toBeNull();
  });

  it("closes on Escape", async () => {
    const { toolbarHost, button } = await mountToolbar("Text");
    button(t("format.moreFormatting"))?.click();
    await vi.waitFor(() => expect(barOpen(toolbarHost)).toBe(true));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await vi.waitFor(() => expect(barOpen(toolbarHost)).toBe(false));
  });
});
