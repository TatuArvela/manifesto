import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./remarkRenderer.js";

/**
 * Note content is not trusted input: it arrives from shared links, imported
 * files and plugin output, and every caller hands the result straight to
 * `dangerouslySetInnerHTML`. These are the cases the allowlist exists for.
 */
describe("renderMarkdown sanitizing", () => {
  it("drops script tags", () => {
    const html = renderMarkdown("hello <script>alert(1)</script> world");
    expect(html).not.toContain("<script");
    // The body survives as inert text, which is the point: nothing is
    // executable, and the note still reads the way it was written.
    expect(html).toContain("alert(1)");
  });

  it("drops event-handler attributes", () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("drops javascript: links", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("drops embedded frames and objects", () => {
    const html = renderMarkdown(
      '<iframe src="https://evil.example"></iframe><object data="x"></object>',
    );
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<object");
  });

  it("drops form controls that are not task-list checkboxes", () => {
    const html = renderMarkdown(
      '<form action="https://evil.example"><button>Send</button></form>',
    );
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
  });

  it("keeps ordinary markdown", () => {
    const html = renderMarkdown("# Title\n\n**bold** and [a link](https://x.y)");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://x.y"');
  });

  it("keeps GFM task-list checkboxes", () => {
    const html = renderMarkdown("- [x] done\n- [ ] todo");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });

  it("keeps tables", () => {
    const html = renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });
});
