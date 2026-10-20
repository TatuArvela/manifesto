/** How much of a selection has a tag. */
export type TagCoverage = "all" | "some" | "none";

/**
 * Each known tag with how many of `selected` have it, in the order of
 * `allTags`.
 */
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
