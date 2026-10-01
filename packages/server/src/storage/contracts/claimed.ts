import type { LinkPreview, NoteCreate } from "@manifesto/shared";
import type {
  ClaimedImages,
  ClaimedPreviews,
  StoredNoteCreate,
} from "../types.js";

// Storage takes only image references `claimImages` has checked (see
// `ClaimedImages`). A storage test writes rows directly, with references it
// made up or none, so it vouches for them here instead.

export function claimedImages(images: string[] = []): ClaimedImages {
  return images as ClaimedImages;
}

export function claimedPreviews(previews: LinkPreview[] = []): ClaimedPreviews {
  return previews as ClaimedPreviews;
}

/** A note's fields with both lists vouched for, to insert directly. */
export function claimed(data: NoteCreate): StoredNoteCreate {
  return {
    ...data,
    images: claimedImages(data.images),
    linkPreviews: claimedPreviews(data.linkPreviews),
  };
}
