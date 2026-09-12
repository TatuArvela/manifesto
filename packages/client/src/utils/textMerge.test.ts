import { describe, expect, it } from "vitest";
import { rebaseEdit } from "./textMerge.js";

describe("rebaseEdit", () => {
  const base = "- [ ] milk\n- [ ] bread\n- [ ] eggs";

  it("keeps both an insertion here and an edit elsewhere", () => {
    const mine = "- [ ] milk\n- [ ] brown bread\n- [ ] eggs";
    const theirs = "- [x] milk\n- [ ] bread\n- [ ] eggs\n- [ ] jam";
    expect(rebaseEdit(base, mine, theirs)).toBe(
      "- [x] milk\n- [ ] brown bread\n- [ ] eggs\n- [ ] jam",
    );
  });

  it("keeps both a deletion here and an edit elsewhere", () => {
    const mine = "- [ ] milk\n- [ ] eggs";
    const theirs = "- [ ] oat milk\n- [ ] bread\n- [ ] eggs";
    expect(rebaseEdit(base, mine, theirs)).toBe("- [ ] oat milk\n- [ ] eggs");
  });

  it("gives up when the other side rewrote the text being edited", () => {
    const mine = "- [ ] milk\n- [ ] brown bread\n- [ ] eggs";
    const theirs = "- [ ] milk\n- [ ] rolls\n- [ ] eggs";
    expect(rebaseEdit(base, mine, theirs)).toBeNull();
  });

  it("passes either side through when only one has changed", () => {
    expect(rebaseEdit(base, base, "other")).toBe("other");
    expect(rebaseEdit(base, "mine", base)).toBe("mine");
  });

  it("places an edit by the nearest copy of repeated text", () => {
    const repeated = "ab ab ab ab ab ab ab ab ab ab ab ab ab ab ab ab";
    const mine = `${repeated}!`;
    const theirs = `X${repeated}`;
    expect(rebaseEdit(repeated, mine, theirs)).toBe(`X${repeated}!`);
  });

  it("does not guess where to put an edit with no text around it", () => {
    expect(rebaseEdit("", "a", "b")).toBeNull();
  });
});
