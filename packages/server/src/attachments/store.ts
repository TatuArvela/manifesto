import {
  ATTACHMENT_REF_PREFIX,
  attachmentIdOf,
  isAttachmentRef,
} from "@manifesto/shared";
import { newId } from "#/lib/ulid.ts";
import { HttpError } from "#/middleware/error.ts";
import type { ClaimedImages, StorageDriver } from "#/storage/types.ts";

/**
 * Each attachment to which a note refers belongs to the owner of the note. The
 * server sweeps it with the notes of the owner, and deletes it with the account
 * of the owner. Now a note names its images inside ciphertext, where the server
 * cannot change a reference. Thus, two steps keep this true:
 *
 * - **`adoptImages`**, before the note is sealed: the writer gives the
 *   references that it will name, and gets back the own reference of the owner
 *   for each one. A reference that the owner already has comes back as it is. A
 *   reference that a different person has is the case of an editor who adds
 *   their own upload to the note of a different person, or copies an image out
 *   of a note shared with them. If the writer can read it, its sealed bytes are
 *   copied to the owner under a new id. The bytes are the same. Thus, the key
 *   that the note has for it still opens it.
 * - **`claimImages`**, when the note is written: each reference that it names
 *   next to a sealed list (`imageRefs`, `previewRefs`) must belong to the owner
 *   by then. The server refuses all other references. If not, a crafted
 *   reference could give a note the image of a different person.
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
  // The only place where a claim is made. Thus, the only cast.
  return images as ClaimedImages;
}

/** The own reference of the owner for each of `refs`, in order. See above. */
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
    // Under its address. The owner has it one time, however many times it
    // comes, and the addresses of two persons for one image are different.
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
