import {
  isTagWithin,
  normalizeTag,
  tagLeaf,
  tagLineage,
  tagParent,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";

describe("nested tags", () => {
  it("normalizes case, spaces and empty parts of a path", () => {
    expect(normalizeTag("  Work ")).toBe("work");
    expect(normalizeTag("Work / Clients/")).toBe("work/clients");
    expect(normalizeTag("/a//b/")).toBe("a/b");
    expect(normalizeTag(" / ")).toBe("");
  });

  it("counts a tag as within itself and its ancestors only", () => {
    expect(isTagWithin("work", "work")).toBe(true);
    expect(isTagWithin("work/clients/acme", "work")).toBe(true);
    expect(isTagWithin("work/clients/acme", "work/clients")).toBe(true);
    expect(isTagWithin("workshop", "work")).toBe(false);
    expect(isTagWithin("work", "work/clients")).toBe(false);
  });

  it("names the parent, the leaf and the lineage", () => {
    expect(tagParent("work/clients/acme")).toBe("work/clients");
    expect(tagParent("work")).toBeNull();
    expect(tagLeaf("work/clients/acme")).toBe("acme");
    expect(tagLeaf("work")).toBe("work");
    expect(tagLineage("work/clients/acme")).toEqual([
      "work",
      "work/clients",
      "work/clients/acme",
    ]);
  });
});
