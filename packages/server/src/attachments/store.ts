import {
  ATTACHMENT_REF_PREFIX,
  attachmentIdOf,
  isAttachmentRef,
} from "@manifesto/shared";
import { newId } from "#/lib/ulid.js";
import { HttpError } from "#/middleware/error.js";
import type { ClaimedImages, StorageDriver } from "#/storage/types.js";

/**
 * Every attachment a note refers to belongs to the note's owner, whose notes
 * it is swept with and whose account it goes with. Two steps keep that true
 * now that a note names its images inside ciphertext, where the server
 * cannot rewrite a reference:
 *
 * - **`adoptImages`**, before the note is sealed: the writer hands over the
 *   references it means to name, and gets back the owner's own for each. One
 *   the owner already holds comes back as it is. One held by someone else is
 *   the case of an editor adding their own upload to another person's note,
 *   or copying an image out of a note shared with them: if the writer may
 *   read it, its sealed bytes are copied to the owner under a new id. The
 *   bytes are the same, so the key the note holds for it still opens it.
 * - **`claimImages`**, when the note is written: each reference it names
 *   beside a sealed list (`imageRefs`, `previewRefs`) must be the owner's by
 *   then. Anything else is refused, or a crafted reference would lend a note
 *   someone else's image.
 */
export async function claimImages(
  storage: StorageDriver,
  images: string[],
  ownerId: string,
): Promise<ClaimedImages> {
  for (const ref of images) {
    if (!isAttachmentRef(ref)) throw new HttpError(422, "Invalid image");
    const meta = await storage.attachments.meta(attachmentIdOf(ref));
    if (meta?.ownerId !== ownerId) {
      throw new HttpError(422, "Unknown attachment");
    }
  }
  // The one place a claim is made, so the one cast.
  return images as ClaimedImages;
}

/** The owner's own reference for each of `refs`, in order; see above. */
export async function adoptImages(
  storage: StorageDriver,
  refs: string[],
  ownerId: string,
  writerId: string,
  now: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const ref of refs) {
    if (!isAttachmentRef(ref)) throw new HttpError(422, "Invalid image");
    const id = attachmentIdOf(ref);
    const meta = await storage.attachments.meta(id);
    if (meta?.ownerId === ownerId) {
      out.push(ref);
      continue;
    }
    if (!meta || !(await storage.attachments.readableBy(id, writerId))) {
      throw new HttpError(422, "Unknown attachment");
    }
    const source = await storage.attachments.get(id);
    if (!source) throw new HttpError(422, "Unknown attachment");
    // Under the address it has: the owner holds it once however many times
    // it is handed over, and two people's addresses for one image differ.
    const copy = await storage.attachments.put({
      id: newId(),
      ownerId,
      sha256: source.sha256,
      contentType: source.contentType,
      data: source.data,
      createdAt: now,
    });
    out.push(`${ATTACHMENT_REF_PREFIX}${copy.id}`);
  }
  return out;
}
