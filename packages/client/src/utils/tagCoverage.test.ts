import { describe, expect, it } from "vitest";
import { tagCoverage } from "./tagCoverage.js";

describe("tagCoverage", () => {
  it("says whether all, some or none of the selection carry each tag", () => {
    const selected = [{ tags: ["a", "b"] }, { tags: ["a"] }];
    expect(tagCoverage(["a", "b", "c"], selected)).toEqual([
      { tag: "a", coverage: "all" },
      { tag: "b", coverage: "some" },
      { tag: "c", coverage: "none" },
    ]);
  });

  it("counts nothing as carried by an empty selection", () => {
    expect(tagCoverage(["a"], [])).toEqual([{ tag: "a", coverage: "none" }]);
  });
});
