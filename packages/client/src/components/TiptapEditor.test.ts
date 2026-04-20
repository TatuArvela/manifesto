import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { getMarkdown, tiptapExtensions } from "./TiptapEditor.js";

function roundTrip(markdown: string): string {
  const el = document.createElement("div");
  const editor = new Editor({
    element: el,
    extensions: tiptapExtensions,
    content: markdown,
  });
  const result = getMarkdown(editor);
  editor.destroy();
  return result;
}

describe("Tiptap markdown round-trip", () => {
  it("preserves plain text", () => {
    expect(roundTrip("Hello world")).toBe("Hello world");
  });

  it("preserves bold", () => {
    expect(roundTrip("**bold text**")).toBe("**bold text**");
  });

  it("preserves italic", () => {
    expect(roundTrip("*italic text*")).toBe("*italic text*");
  });

  it("preserves strikethrough", () => {
    expect(roundTrip("~~struck~~")).toBe("~~struck~~");
  });

  it("preserves inline code", () => {
    expect(roundTrip("`code`")).toBe("`code`");
  });

  it("preserves headings", () => {
    expect(roundTrip("# Heading 1")).toBe("# Heading 1");
    expect(roundTrip("## Heading 2")).toBe("## Heading 2");
    expect(roundTrip("### Heading 3")).toBe("### Heading 3");
    expect(roundTrip("#### Heading 4")).toBe("#### Heading 4");
  });

  it("preserves blockquotes", () => {
    expect(roundTrip("> quoted text")).toBe("> quoted text");
  });

  it("preserves unordered lists", () => {
    const md = "- item 1\n- item 2\n- item 3";
    expect(roundTrip(md)).toBe(md);
  });

  it("preserves ordered lists", () => {
    const md = "1. first\n2. second\n3. third";
    expect(roundTrip(md)).toBe(md);
  });

  it("preserves links", () => {
    expect(roundTrip("[link](https://example.com)")).toBe(
      "[link](https://example.com)",
    );
  });

  it("preserves task lists", () => {
    const md = "- [ ] unchecked\n- [x] checked";
    expect(roundTrip(md)).toBe(md);
  });

  it("preserves nested task lists", () => {
    const md =
      "- [ ] parent\n\n  - [x] child\n  - [ ] child 2\n\n- [x] sibling";
    const result = roundTrip(md);
    // Verify tasks round-trip with nesting preserved
    expect(result).toContain("[ ] parent");
    expect(result).toContain("[x] child");
    expect(result).toContain("[ ] child 2");
    expect(result).toContain("[x] sibling");
  });

  it("preserves underline HTML", () => {
    expect(roundTrip("<u>underlined</u>")).toBe("<u>underlined</u>");
  });

  it("preserves subscript HTML", () => {
    expect(roundTrip("<sub>subscript</sub>")).toBe("<sub>subscript</sub>");
  });

  it("preserves superscript HTML", () => {
    expect(roundTrip("<sup>superscript</sup>")).toBe("<sup>superscript</sup>");
  });

  it("preserves mixed content", () => {
    const md = [
      "# Title",
      "",
      "Some **bold** and *italic* text.",
      "",
      "- [ ] task one",
      "- [x] task two",
      "",
      "> a quote",
    ].join("\n");
    expect(roundTrip(md)).toBe(md);
  });
});
