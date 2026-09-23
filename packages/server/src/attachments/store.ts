import { createHash } from "node:crypto";
import {
  ATTACHMENT_REF_PREFIX,
  attachmentIdOf,
  IMAGE_DATA_URL_PATTERN,
  isAttachmentRef,
} from "@manifesto/shared";
import { newId } from "../lib/ulid.js";
import { HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";

/**
 * Takes the bytes out of a note's images: every inline `data:` image is put
 * in the attachment store under the note's owner and replaced by its
 * `attachment:<id>` reference, so the row, every listing and reply, each
 * conflict retry and every version a client keeps carry a few dozen bytes per
 * image instead of up to 1.5 MB.
 *
 * A reference the owner already holds passes through. One held by someone
 * else is the case of an editor copying an image from another person's note:
 * if the writer may read it, it is copied to the owner, since an attachment
 * belongs to the notes of one account and is swept with them. Anything else
 * is refused, or a crafted reference would lend a note someone else's image.
 */
export async function storeInlineImages(
  storage: StorageDriver,
  images: string[],
  ownerId: string,
  writerId: string,
  now: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const image of images) {
    if (isAttachmentRef(image)) {
      out.push(await ownedRef(storage, image, ownerId, writerId, now));
      continue;
    }
    const decoded = decodeDataUrl(image);
    if (!decoded) throw new HttpError(422, "Invalid image");
    out.push(
      await put(storage, ownerId, decoded.contentType, decoded.data, now),
    );
  }
  return out;
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
  return put(storage, ownerId, source.contentType, source.data, now);
}

async function put(
  storage: StorageDriver,
  ownerId: string,
  contentType: string,
  data: Buffer,
  now: string,
): Promise<string> {
  const stored = await storage.attachments.put({
    id: newId(),
    ownerId,
    sha256: createHash("sha256").update(data).digest("hex"),
    contentType,
    data,
    createdAt: now,
  });
  return `${ATTACHMENT_REF_PREFIX}${stored.id}`;
}

/** The media type and bytes of an accepted image `data:` URL. */
export function decodeDataUrl(
  image: string,
): { contentType: string; data: Buffer } | null {
  if (!IMAGE_DATA_URL_PATTERN.test(image)) return null;
  const comma = image.indexOf(",");
  const subtype = image
    .slice("data:image/".length, image.indexOf(";"))
    .toLowerCase();
  return {
    contentType: `image/${subtype === "jpg" ? "jpeg" : subtype}`,
    data: Buffer.from(image.slice(comma + 1), "base64"),
  };
}

/**
 * Moves images written before the store existed out of their rows, a batch at
 * a time, without stamping the notes (see `setNoteImages`). Run at startup.
 * Returns how many notes it moved.
 */
export async function moveInlineImagesToStore(
  storage: StorageDriver,
  now: string,
): Promise<number> {
  let moved = 0;
  for (;;) {
    const batch = await storage.attachments.notesWithInlineImages(50);
    if (batch.length === 0) return moved;
    for (const note of batch) {
      const images = await storeInlineImages(
        storage,
        note.images.filter(
          (i) => isAttachmentRef(i) || IMAGE_DATA_URL_PATTERN.test(i),
        ),
        note.ownerId,
        note.ownerId,
        now,
      );
      await storage.attachments.setNoteImages(note.id, images);
      moved++;
    }
  }
}
