/**
 * How much unchanged text either side of an edit is used to find it again,
 * longest first: more is more certain, but more is also likelier to run into
 * the other side's edit when the two are close together.
 */
const CONTEXTS = [24, 12, 6, 3];

/**
 * Replays one local edit onto text that someone else has changed since.
 *
 * `base` is the text both sides last agreed on, `mine` is `base` after the
 * local edit, and `theirs` is `base` after the other side's. A textarea edit
 * between two syncs is a single splice (a keystroke, a paste, a toolbar press),
 * so it is taken as one: the span that differs between `base` and `mine`, and
 * found again in `theirs` by the text around it. Returns `theirs` with the
 * splice applied, or null when that text is gone or is not unique enough to
 * place the edit, in which case the caller has to pick a side.
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
    // No text around the edit to go on (a note that was empty, say): a match
    // would only be a guess.
    if (needle.length === 0) return null;

    // Where the needle sat in `base`; when it occurs more than once in
    // `theirs`, the nearest is the one meant.
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
