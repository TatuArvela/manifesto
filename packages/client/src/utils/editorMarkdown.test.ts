import { describe, expect, it } from "vitest";
import { normalizeMarkdown } from "./editorMarkdown.js";

describe("normalizeMarkdown", () => {
  const fence = "```";

  it("unescapes the brackets prosemirror-markdown added", () => {
    expect(normalizeMarkdown("Post \\[ \\] Maa")).toBe("Post [ ] Maa");
  });

  it("leaves brackets inside a code block escaped", () => {
    // A note explaining how to escape a bracket had its own example silently
    // corrected, so the thing it was demonstrating stopped being visible.
    const md = ["Escape it:", fence, "\\[not a box\\]", fence].join("\n");
    expect(normalizeMarkdown(md)).toBe(md);
  });

  it("collapses the blank lines mdast puts between list items", () => {
    expect(normalizeMarkdown("- one\n\n- two")).toBe("- one\n- two");
  });

  it("keeps a blank line inside a code block", () => {
    // Two lines starting with `-` and a gap between them is a diff, not a
    // list; closing the gap changes what the code says.
    const md = [fence, "- one", "", "- two", fence].join("\n");
    expect(normalizeMarkdown(md)).toBe(md);
  });

  it("keeps a blank line that is not between two list items", () => {
    expect(normalizeMarkdown("para\n\n- one")).toBe("para\n\n- one");
  });
});
