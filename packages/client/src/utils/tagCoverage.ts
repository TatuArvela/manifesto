/** How much of a selection carries a tag. */
export type TagCoverage = "all" | "some" | "none";

/** Every known tag with how many of `selected` carry it, in `allTags` order. */
export function tagCoverage(
  allTags: string[],
  selected: { tags: string[] }[],
): { tag: string; coverage: TagCoverage }[] {
  return allTags.map((tag) => {
    const carrying = selected.filter((n) => n.tags.includes(tag)).length;
    const coverage =
      carrying === 0 ? "none" : carrying === selected.length ? "all" : "some";
    return { tag, coverage };
  });
}
