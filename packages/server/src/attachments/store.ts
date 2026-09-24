import { createHash } from "node:crypto";
import {
  ATTACHMENT_REF_PREFIX,
  attachmentIdOf,
  isAttachmentRef,
  type LinkPreview,
  mapPreviewImages,
} from "@manifesto/shared";
import { newId } from "../lib/ulid.js";
import { HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";

/**
 * The images a note write names, made the note owner's. A note's `images`
 * holds `attachment:<id>` references only (uploads come first, through
 * `POST /api/attachments`), and every attachment a note refers to belongs to
 * the note's owner, whose notes it is swept with.
 *
 * A reference the owner already holds passes through. One held by someone
 * else is the case of an editor adding their own upload to another person's
 * note, or copying an image out of a note shared with them: if the writer may
 * read it, it is copied to the owner. Anything else is refused, or a crafted
 * reference would lend a note someone else's image.
 */
export async function claimImages(
  storage: StorageDriver,
  images: string[],
  ownerId: string,
  writerId: string,
  now: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const ref of images) {
    if (!isAttachmentRef(ref)) throw new HttpError(422, "Invalid image");
    out.push(await ownedRef(storage, ref, ownerId, writerId, now));
  }
  return out;
}

/**
 * The same for the thumbnails and favicons of a note's link previews, which
 * are attachments like any image. Validation has already limited each to an
 * attachment reference or, on a row from before previews were stored, a
 * remote URL, which passes through.
 */
export async function claimPreviewImages(
  storage: StorageDriver,
  previews: LinkPreview[],
  ownerId: string,
  writerId: string,
  now: string,
): Promise<LinkPreview[]> {
  return await mapPreviewImages(previews, async (image) =>
    isAttachmentRef(image)
      ? await ownedRef(storage, image, ownerId, writerId, now)
      : image,
  );
}

async function ownedRef(
  storage: StorageDriver,
  ref: string,
  ownerId: string,
  writerId: string,
  now: string,
): Promise<string> {
  const id = attachmentIdOf(ref);
  const meta = await storage.attachments.meta(id);
  if (meta?.ownerId === ownerId) return ref;
  if (!meta || !(await storage.attachments.readableBy(id, writerId))) {
    throw new HttpError(422, "Unknown attachment");
  }
  const source = await storage.attachments.get(id);
  if (!source) throw new HttpError(422, "Unknown attachment");
  const copy = await storage.attachments.put({
    id: newId(),
    ownerId,
    sha256: createHash("sha256").update(source.data).digest("hex"),
    contentType: source.contentType,
    data: source.data,
    createdAt: now,
  });
  return `${ATTACHMENT_REF_PREFIX}${copy.id}`;
}
