import { describe, expect, it } from "vitest";
import {
  noteTerms,
  prefixRange,
  queryTerms,
  searchFilter,
  touchesText,
} from "./searchTerms.js";

describe("noteTerms", () => {
  it("counts words across title and content, folding case", () => {
    const terms = noteTerms("Milk run", "- [ ] milk\n- [x] **Eggs**");
    expect(Object.fromEntries(terms)).toEqual({ milk: 2, run: 1, eggs: 1 });
  });

  it("segments scripts written without spaces", () => {
    expect(noteTerms("", "東京都に行く").size).toBeGreaterThan(1);
  });

  it("caps a very long word", () => {
    const [term] = noteTerms("", "a".repeat(500)).keys();
    expect(term).toHaveLength(64);
  });
});

describe("queryTerms", () => {
  it("drops a prefix implied by a longer word", () => {
    expect(queryTerms("mil milk MILK eggs")).toEqual(["milk", "eggs"]);
  });

  it("is empty for a query with no words", () => {
    expect(queryTerms("-> !!")).toEqual([]);
  });
});

describe("prefixRange", () => {
  it("bounds exactly the strings that start with the prefix", () => {
    const [lo, hi] = prefixRange("mil");
    expect([lo, hi]).toEqual(["mil", "mim"]);
    for (const word of ["mil", "milk", "mil\u{10ffff}"]) {
      expect(word >= lo && word < hi).toBe(true);
    }
    for (const word of ["mik", "mim", "mi"]) {
      expect(word >= lo && word < hi).toBe(false);
    }
  });

  it("steps over the surrogate range", () => {
    expect(prefixRange("퟿")[1]).toBe("");
  });
});

describe("searchFilter", () => {
  it("prefers words and falls back to a substring", () => {
    expect(searchFilter("milk")?.kind).toBe("terms");
    expect(searchFilter("->")).toEqual({ kind: "like", like: "%->%" });
    expect(searchFilter("%")).toBeNull();
  });
});

describe("touchesText", () => {
  it("is true only for the title and content", () => {
    expect(touchesText({ title: "x" })).toBe(true);
    expect(touchesText({ content: "" })).toBe(true);
    expect(touchesText({ pinned: true })).toBe(false);
  });
});
