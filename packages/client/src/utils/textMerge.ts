/**
 * How much unchanged text on each side of an edit the code uses to find it
 * again, longest first. More text is more certain, but more text is also more
 * probable to go into the edit of the other side when the two are near.
 */
const CONTEXTS = [24, 12, 6, 3];

/**
 * Applies one local edit again onto text that a different person changed since
 * then.
 *
 * `base` is the text on which both sides last agreed. `mine` is `base` after
 * the local edit, and `theirs` is `base` after the edit of the other side. A
 * textarea edit between two syncs is a single splice (a keystroke, a paste, a
 * toolbar press). Thus, the code takes it as one: the span that is different
 * between `base` and `mine`, found again in `theirs` by the text around it.
 * Returns `theirs` with the splice applied, or null when that text is gone, or
 * is not sufficiently unique to place the edit. Then the caller must select a
 * side.
 */
export function rebaseEdit(
  base: string,
  mine: string,
  theirs: string,
): string | null {
  if (mine === base) return theirs;
  if (theirs === base) return mine;

  let prefix = 0;
  const max = Math.min(base.length, mine.length);
  while (prefix < max && base[prefix] === mine[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    base[base.length - 1 - suffix] === mine[mine.length - 1 - suffix]
  ) {
    suffix++;
  }

  const removedEnd = base.length - suffix;
  const removed = base.slice(prefix, removedEnd);
  const inserted = mine.slice(prefix, mine.length - suffix);

  for (const size of CONTEXTS) {
    const left = base.slice(Math.max(0, prefix - size), prefix);
    const right = base.slice(removedEnd, removedEnd + size);
    const needle = left + removed + right;
    // No text around the edit to use (for example, a note that was empty). A
    // match would only be a guess.
    if (needle.length === 0) return null;

    // Where the needle was in `base`. When it occurs more than one time in
    // `theirs`, the nearest occurrence is the correct one.
    const expectedAt = prefix - left.length;
    let best = -1;
    for (
      let at = theirs.indexOf(needle);
      at !== -1;
      at = theirs.indexOf(needle, at + 1)
    ) {
      if (
        best === -1 ||
        Math.abs(at - expectedAt) < Math.abs(best - expectedAt)
      ) {
        best = at;
      }
    }
    if (best === -1) continue;
    return (
      theirs.slice(0, best) +
      left +
      inserted +
      right +
      theirs.slice(best + needle.length)
    );
  }
  return null;
}
