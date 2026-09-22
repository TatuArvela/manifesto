import { describe, expect, it } from "vitest";
import { renderInlineMarkdown, renderMarkdown } from "./remarkRenderer.js";

/**
 * Note content is not trusted input: it arrives from shared links, imported
 * files and plugin output, and every caller hands the result straight to
 * `dangerouslySetInnerHTML`. These are the cases the allowlist exists for.
 */
describe("renderMarkdown sanitizing", () => {
  it("drops script tags and their contents", () => {
    const html = renderMarkdown("hello <script>alert(1)</script> world");
    expect(html).not.toContain("<script");
    // The body goes with it. Raw HTML reaches the sanitizer now, so DOMPurify
    // treats this as the element it is rather than as the loose text that
    // remark-rehype used to leave behind, and it removes a script whole.
    // Nothing is lost: the note's markdown still says what the user typed;
    // this is only what the preview draws.
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("hello");
    expect(html).toContain("world");
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
    const html = renderMarkdown(
      "# Title\n\n**bold** and [a link](https://x.y)",
    );
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://x.y"');
  });

  it("opens links in a new tab, whatever target the markdown asked for", () => {
    for (const md of [
      "[a link](https://x.y)",
      '<a href="https://x.y" target="_self" rel="opener">raw</a>',
    ]) {
      const html = renderMarkdown(md);
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).not.toContain("_self");
    }
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

describe("renderMarkdown raw HTML", () => {
  it.each(["u", "sub", "sup"])(
    "keeps <%s>, which the formatting toolbar writes",
    (tag) => {
      // These sat in the allowlist looking permitted while `remark-rehype`
      // dropped every raw HTML node before the sanitizer was ever asked, so
      // underline and sub/superscript silently vanished from every preview.
      const html = renderMarkdown(`a <${tag}>b</${tag}> c`);
      expect(html).toContain(`<${tag}>b</${tag}>`);
    },
  );

  it("still refuses a tag outside the allowlist", () => {
    const html = renderMarkdown("<marquee>hi</marquee>");
    expect(html).not.toContain("<marquee");
    expect(html).toContain("hi");
  });

  it("still refuses an event handler on a tag it allows", () => {
    const html = renderMarkdown('<u onmouseover="alert(1)">hi</u>');
    expect(html).toContain("<u>");
    expect(html).not.toContain("onmouseover");
  });
});

describe("renderInlineMarkdown", () => {
  it("unwraps the paragraph a fragment is parsed into", () => {
    expect(renderInlineMarkdown("**milk** and eggs")).toBe(
      "<strong>milk</strong> and eggs",
    );
  });

  it("renders an empty label as nothing", () => {
    expect(renderInlineMarkdown("")).toBe("");
  });

  it("keeps block markup when the fragment really is a block", () => {
    // Better ugly than swallowed: unwrapping here would drop list items.
    const html = renderInlineMarkdown("- one\n- two");
    expect(html).toContain("<li>one</li>");
  });

  it("sanitizes, like the block renderer", () => {
    expect(renderInlineMarkdown('<u onclick="x()">hi</u>')).toBe("<u>hi</u>");
  });
});

describe("renderMarkdown cache", () => {
  it("answers a repeat from the cache, sanitized as the first time", () => {
    const md = 'cached <img src="x" onerror="alert(1)"> **text**';
    const first = renderMarkdown(md);
    expect(renderMarkdown(md)).toBe(first);
    expect(first).not.toContain("onerror");
    expect(first).toContain("<strong>text</strong>");
  });

  it("keeps rendering correctly past the cache's size", () => {
    for (let i = 0; i < 2100; i++) renderMarkdown(`note ${i}`);
    expect(renderMarkdown("note 0")).toBe("<p>note 0</p>");
    expect(renderMarkdown("note 2099")).toBe("<p>note 2099</p>");
  });
});
