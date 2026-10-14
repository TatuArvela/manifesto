import { describe, expect, it } from "vitest";
import { cardName } from "./cardName.js";

describe("cardName", () => {
  it("is the title when there is one", () => {
    expect(cardName({ title: " Shopping ", content: "Milk" })).toBe("Shopping");
  });

  it("is the first line of the text without the Markdown that opens it", () => {
    expect(cardName({ title: "", content: "\n## Plans\nmore" })).toBe("Plans");
    expect(cardName({ title: "", content: "- [x] Milk\n- [ ] Eggs" })).toBe(
      "Milk",
    );
    expect(cardName({ title: "", content: "> - 1. Deep" })).toBe("Deep");
    expect(cardName({ title: "", content: "#hashtag" })).toBe("#hashtag");
  });

  it("skips lines that are only a marker", () => {
    expect(cardName({ title: "", content: "-\n- [ ]\nReal" })).toBe("Real");
  });

  it("shortens a long line", () => {
    const name = cardName({ title: "", content: "a".repeat(200) });
    expect(name).toBe(`${"a".repeat(80)}…`);
  });

  it("is empty when there is nothing to call it", () => {
    expect(cardName({ title: "", content: " \n\n" })).toBe("");
  });
});
