import type { LinkPreview, Note, NoteUpdate } from "@manifesto/shared";

function mergeStringArray(
  base: string[],
  desired: string[],
  current: string[],
): string[] {
  const baseSet = new Set(base);
  const desiredSet = new Set(desired);
  const added = desired.filter((x) => !baseSet.has(x));
  const removed = base.filter((x) => !desiredSet.has(x));
  const removedSet = new Set(removed);
  const result = current.filter((x) => !removedSet.has(x));
  for (const x of added) {
    if (!result.includes(x)) result.push(x);
  }
  return result;
}

function mergeLinkPreviews(
  base: LinkPreview[],
  desired: LinkPreview[],
  current: LinkPreview[],
): LinkPreview[] {
  const baseUrls = new Set(base.map((p) => p.url));
  const desiredUrls = new Set(desired.map((p) => p.url));
  const removed = base.filter((p) => !desiredUrls.has(p.url));
  const removedSet = new Set(removed.map((p) => p.url));
  const result = current.filter((p) => !removedSet.has(p.url));
  for (const preview of desired) {
    if (baseUrls.has(preview.url)) continue;
    if (!result.some((p) => p.url === preview.url)) result.push(preview);
  }
  return result;
}

/**
 * 3-way merge for a NoteUpdate that lost the optimistic-concurrency race.
 *
 * - `base`: the snapshot the user was looking at when they triggered the
 *   update (the local cached note before the optimistic mutation).
 * - `desired`: the partial change set the user requested.
 * - `current`: the latest server state returned in the 412 response.
 *
 * Scalars in `desired` overwrite the server value (client wins). Array
 * fields (`tags`, `images`, `linkPreviews`) are merged 3-way: items
 * the user added survive concurrent additions; items the user removed
 * are removed from the current state; items added by the other writer
 * are preserved.
 */
export function mergeNoteUpdate(
  base: Note,
  desired: NoteUpdate,
  current: Note,
): NoteUpdate {
  const merged: NoteUpdate = { ...desired };
  if (desired.tags !== undefined) {
    merged.tags = mergeStringArray(base.tags, desired.tags, current.tags);
  }
  if (desired.images !== undefined) {
    merged.images = mergeStringArray(
      base.images,
      desired.images,
      current.images,
    );
  }
  if (desired.linkPreviews !== undefined) {
    merged.linkPreviews = mergeLinkPreviews(
      base.linkPreviews,
      desired.linkPreviews,
      current.linkPreviews,
    );
  }
  return merged;
}
