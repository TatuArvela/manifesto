import { describe, expect, it } from "vitest";
import {
  findItemDate,
  hasDatedItems,
  itemDateClass,
  labelDate,
  localIsoDate,
  sortChecklistByDate,
} from "./itemDate.js";

describe("findItemDate", () => {
  it("finds the token and where it sits", () => {
    const text = "Call the plumber @2026-10-02";
    const found = findItemDate(text);
    expect(found?.date).toBe("2026-10-02");
    expect(text.slice(found?.start, found?.end)).toBe("@2026-10-02");
  });

  it("finds a token at the start and before punctuation", () => {
    expect(findItemDate("@2026-10-02 call")?.start).toBe(0);
    expect(findItemDate("call (by @2026-10-02).")?.date).toBe("2026-10-02");
    expect(findItemDate("call @2026-10-02, then pay")?.date).toBe("2026-10-02");
  });

  it("leaves an address, a longer number and a day that does not exist", () => {
    expect(findItemDate("mail me@2026-10-02")).toBeNull();
    expect(findItemDate("see @2026-10-021")).toBeNull();
    expect(findItemDate("see @2026-10-02-draft")).toBeNull();
    expect(findItemDate("on @2026-02-30")).toBeNull();
    expect(findItemDate("on @2026-13-01")).toBeNull();
  });

  it("takes the first real date", () => {
    expect(
      findItemDate("@2026-02-30 or @2026-03-01 or @2026-04-01")?.date,
    ).toBe("2026-03-01");
  });
});

describe("labelDate", () => {
  it("skips a token quoted in a code span", () => {
    expect(labelDate("type `@2026-10-02` to date it")).toBeNull();
    expect(labelDate("`x` then @2026-10-02")).toBe("2026-10-02");
  });
});

describe("itemDateClass", () => {
  it("marks an open item overdue only from the day after", () => {
    expect(itemDateClass("2026-10-02", false, "2026-10-03")).toContain(
      "item-date-overdue",
    );
    expect(itemDateClass("2026-10-03", false, "2026-10-03")).toBe("item-date");
    expect(itemDateClass("2026-10-02", true, "2026-10-03")).toBe("item-date");
  });
});

describe("localIsoDate", () => {
  it("writes the local day, zero padded", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("hasDatedItems", () => {
  it("counts only checklist items outside a fence", () => {
    expect(hasDatedItems("- [ ] a @2026-10-02")).toBe(true);
    expect(hasDatedItems("- a @2026-10-02")).toBe(false);
    expect(hasDatedItems("```\n- [ ] a @2026-10-02\n```")).toBe(false);
    expect(hasDatedItems("- [ ] a")).toBe(false);
  });
});

describe("sortChecklistByDate", () => {
  it("puts the soonest first and the undated last, in their old order", () => {
    const content = [
      "- [ ] none one",
      "- [ ] late @2026-12-01",
      "- [x] soon @2026-10-02",
      "- [ ] none two",
      "- [ ] also soon @2026-10-02",
    ].join("\n");
    expect(sortChecklistByDate(content).split("\n")).toEqual([
      "- [x] soon @2026-10-02",
      "- [ ] also soon @2026-10-02",
      "- [ ] late @2026-12-01",
      "- [ ] none one",
      "- [ ] none two",
    ]);
  });

  it("moves children with their parent and sorts them among themselves", () => {
    const content = [
      "- [ ] b @2026-11-01",
      "  - [ ] b2 @2026-11-09",
      "  - [ ] b1 @2026-11-02",
      "- [ ] a @2026-10-01",
      "  - [ ] a1",
    ].join("\n");
    expect(sortChecklistByDate(content).split("\n")).toEqual([
      "- [ ] a @2026-10-01",
      "  - [ ] a1",
      "- [ ] b @2026-11-01",
      "  - [ ] b1 @2026-11-02",
      "  - [ ] b2 @2026-11-09",
    ]);
  });

  it("sorts each run of items on its own and leaves other text alone", () => {
    const content = [
      "# List",
      "- [ ] b @2026-11-01",
      "- [ ] a @2026-10-01",
      "",
      "Later:",
      "- [ ] d @2026-09-01",
      "```",
      "- [ ] z @2026-12-01",
      "- [ ] y @2026-01-01",
      "```",
    ].join("\n");
    expect(sortChecklistByDate(content).split("\n")).toEqual([
      "# List",
      "- [ ] a @2026-10-01",
      "- [ ] b @2026-11-01",
      "",
      "Later:",
      "- [ ] d @2026-09-01",
      "```",
      "- [ ] z @2026-12-01",
      "- [ ] y @2026-01-01",
      "```",
    ]);
  });

  it("returns a list already in order unchanged", () => {
    const content = "- [ ] a @2026-10-01\n- [ ] b";
    expect(sortChecklistByDate(content)).toBe(content);
  });
});
