import { NoteColor, NoteFont } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { NoteEditor } from "./NoteEditor.js";
import "../styles.css";

/**
 * On a phone the editor fills the screen and its middle scrolls. What sits
 * under the text (the timestamps, tags, link previews) must follow the text,
 * however long it is, and never be drawn on top of it.
 */

let host: HTMLDivElement;

const noop = () => {};

function renderEditor(content: string) {
  render(
    <NoteEditor
      title="Long"
      onTitleChange={noop}
      content={content}
      onContentChange={noop}
      color={NoteColor.Default}
      onColorChange={noop}
      font={NoteFont.Default}
      onFontChange={noop}
      images={[]}
      onAddImages={noop}
      onRemoveImage={noop}
      linkPreviews={[]}
      onAddLinkPreviews={noop}
      onRemoveLinkPreview={noop}
      pinned={false}
      onPinToggle={noop}
      tags={["groceries"]}
      onAddTag={noop}
      onRemoveTag={noop}
      onDone={noop}
      metadata={<div data-testid="metadata">Created yesterday</div>}
    />,
    host,
  );
}

beforeEach(async () => {
  await page.viewport(375, 600);
  host = document.createElement("div");
  // Where `NoteCard` puts the panel on a phone: the whole screen.
  host.className = "fixed inset-0";
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe("the editor on a phone", () => {
  it("puts the timestamps below a note longer than the screen", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`);
    renderEditor(lines.join("\n\n"));

    const text = await vi.waitFor(() => {
      const editor = host.querySelector<HTMLElement>(".milkdown-editor");
      expect(editor?.textContent).toContain("Line 60");
      return editor as HTMLElement;
    });
    const metadata = host.querySelector<HTMLElement>(
      '[data-testid="metadata"]',
    ) as HTMLElement;

    const textBottom = text.getBoundingClientRect().bottom;
    expect(metadata.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      textBottom,
    );
  });
});
