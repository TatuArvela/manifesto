import {
  imageAltsOf,
  type LinkPreview,
  type Note,
  type NoteUpdate,
} from "@manifesto/shared";
import { sameValue } from "./incomingNote.ts";

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
  const baseByUrl = new Map(base.map((p) => [p.url, p]));
  const desiredUrls = new Set(desired.map((p) => p.url));
  const removed = base.filter((p) => !desiredUrls.has(p.url));
  const removedSet = new Set(removed.map((p) => p.url));
  const result = current.filter((p) => !removedSet.has(p.url));
  for (const preview of desired) {
    const before = baseByUrl.get(preview.url);
    if (before) {
      // Only a preview this writer changed (a stub filled in, a title edited)
      // overwrites the server's copy. One it kept as it was must not: the
      // other writer may have filled it in, and the stale copy would undo that.
      if (sameValue(before, preview)) continue;
      const idx = result.findIndex((p) => p.url === preview.url);
      if (idx !== -1) result[idx] = preview;
      continue;
    }
    if (!result.some((p) => p.url === preview.url)) result.push(preview);
  }
  return result;
}

/**
 * Each image's description after a merge: the one this writer gave it where
 * they changed it, the server's otherwise. Keyed by image, so it follows the
 * merged list whatever either writer added, removed or moved.
 */
function mergeImageAlts(
  base: Note,
  desired: NoteUpdate,
  current: Note,
  images: string[],
): string[] {
  const altsBy = (note: Pick<Note, "images" | "imageAlts">) => {
    const alts = imageAltsOf(note);
    return new Map(note.images.map((image, i) => [image, alts[i] ?? ""]));
  };
  const before = altsBy(base);
  const mine = altsBy({
    images: desired.images ?? base.images,
    imageAlts: desired.imageAlts ?? base.imageAlts ?? [],
  });
  const theirs = altsBy(current);
  const alts = images.map((image) => {
    const own = mine.get(image);
    return own !== undefined && own !== (before.get(image) ?? "")
      ? own
      : (theirs.get(image) ?? own ?? "");
  });
  return alts.some((alt) => alt !== "") ? alts : [];
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
 * are preserved. `imageAlts` is merged by image, beside the merged list.
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
  // The descriptions are sealed inside the image list, so they go with it.
  if (desired.images !== undefined || desired.imageAlts !== undefined) {
    const images = merged.images ?? current.images;
    merged.images = images;
    const alts = mergeImageAlts(base, desired, current, images);
    // Left out when there is nothing to keep and nothing to clear.
    if (
      alts.length > 0 ||
      desired.imageAlts !== undefined ||
      current.imageAlts !== undefined
    ) {
      merged.imageAlts = alts;
    }
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
