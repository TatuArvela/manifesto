import { describe, expect, it } from "vitest";
import { containsTerms, foldForSearch, searchTerms } from "./searchText.js";

describe("foldForSearch", () => {
  it("lowers case and takes accents off", () => {
    expect(foldForSearch("Café SÄÄ Ñandú")).toBe("cafe saa nandu");
  });

  it("leaves no combining dot behind a capital dotted I", () => {
    expect(foldForSearch("İstanbul")).toBe("istanbul");
  });

  it("keeps letters that are not an accented form of another", () => {
    expect(foldForSearch("Øl ß")).toBe("øl ß");
  });
});

describe("searchTerms", () => {
  it("splits on any run of whitespace and folds each word", () => {
    expect(searchTerms("  Milk\t\nÉGGS  ")).toEqual(["milk", "eggs"]);
  });

  it("has no terms for a blank query", () => {
    expect(searchTerms("   ")).toEqual([]);
  });
});

describe("containsTerms", () => {
  it("needs every term, in any order", () => {
    const text = foldForSearch("Eggs, bread and **milk**");
    expect(containsTerms(text, searchTerms("milk eggs"))).toBe(true);
    expect(containsTerms(text, searchTerms("milk butter"))).toBe(false);
  });

  it("matches part of a word", () => {
    expect(containsTerms("groceries", ["grocer"])).toBe(true);
  });
});
