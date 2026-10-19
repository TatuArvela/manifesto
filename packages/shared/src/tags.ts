/**
 * Nested tags. A tag is still one string on a note. A `/` in it makes it a path
 * (`work/clients/acme`). All code that asks "is this note under that tag" gets
 * the answer here, on the client and on the server.
 */
export const TAG_SEPARATOR = "/";

/**
 * A tag as it is stored: trimmed and lowercase, each part of a path trimmed,
 * and no empty part. Thus, `Work / Clients/` and `work/clients` are one tag.
 */
export function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .split(TAG_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(TAG_SEPARATOR);
}

/** If `tag` is `ancestor` itself, or is anywhere under it. */
export function isTagWithin(tag: string, ancestor: string): boolean {
  return tag === ancestor || tag.startsWith(ancestor + TAG_SEPARATOR);
}

/** The tag one level up, or null for a tag at the top. */
export function tagParent(tag: string): string | null {
  const at = tag.lastIndexOf(TAG_SEPARATOR);
  return at < 0 ? null : tag.slice(0, at);
}

/** The last part of the path of a tag: its name among its siblings. */
export function tagLeaf(tag: string): string {
  return tag.slice(tag.lastIndexOf(TAG_SEPARATOR) + 1);
}

/** A tag and each tag above it, from the top down: `a`, `a/b`, `a/b/c`. */
export function tagLineage(tag: string): string[] {
  const lineage: string[] = [];
  for (let at: string | null = tag; at !== null; at = tagParent(at)) {
    lineage.unshift(at);
  }
  return lineage;
}
