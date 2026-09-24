import {
  isStoredImageRef,
  type LinkPreview,
  MAX_IMAGE_SOURCE_BYTES,
  mapPreviewImages,
} from "@manifesto/shared";
import { storage } from "../storage/index.js";
import { blobToDataUrl } from "../utils/dataUrl.js";
import { shrinkImage } from "../utils/shrinkImage.js";

/**
 * Images the server keeps in its attachment store reach a note as
 * `attachment:<id>` references. The bytes need the session's credentials, so
 * an `<img>` cannot point at them; they are fetched once and shown through a
 * `blob:` URL (which the page's CSP allows), kept for the session. An id
 * names one set of bytes for good, so a cached copy never goes stale.
 */
const objectUrls = new Map<string, Promise<string | null>>();

/** A `blob:` URL showing the attachment, or null if it could not be read. */
export function attachmentObjectUrl(ref: string): Promise<string | null> {
  let pending = objectUrls.get(ref);
  if (!pending) {
    pending = storage
      .loadImage(ref)
      .then((blob) => URL.createObjectURL(blob))
      .catch(() => {
        // Not cached: the next card to ask tries again.
        objectUrls.delete(ref);
        return null;
      });
    objectUrls.set(ref, pending);
  }
  return pending;
}

/**
 * The images with every reference replaced by its bytes as a `data:` URL, for
 * anything that leaves this session: an export, a JSON download. A file that
 * named attachments would be unreadable anywhere else. Null if any could not
 * be read, since a backup quietly missing a picture is worse than none.
 */
export async function inlineImages(images: string[]): Promise<string[] | null> {
  const out: string[] = [];
  for (const image of images) {
    if (!isStoredImageRef(image)) {
      out.push(image);
      continue;
    }
    try {
      const dataUrl = await blobToDataUrl(await storage.loadImage(image));
      if (dataUrl === null) return null;
      out.push(dataUrl);
    } catch {
      return null;
    }
  }
  return out;
}

/**
 * The previews with each thumbnail and favicon inlined, for the same reason as
 * `inlineImages`. One that cannot be read is dropped and the card kept: it is
 * a picture of the linked page, not something the user attached.
 */
export async function inlinePreviewImages(
  previews: LinkPreview[],
): Promise<LinkPreview[]> {
  return await mapPreviewImages(previews, async (image) => {
    if (!isStoredImageRef(image)) return image;
    try {
      return (await blobToDataUrl(await storage.loadImage(image))) ?? undefined;
    } catch {
      return undefined;
    }
  });
}

export class ImageTooLargeError extends Error {
  constructor() {
    super("Image too large");
    this.name = "ImageTooLargeError";
  }
}

/**
 * Makes an attached file into something a note can hold: shrunk to a
 * sensible size, checked against the limit, and stored (uploaded, in
 * connected mode, reporting progress). The bytes are remembered under the
 * reference, so the image the user just attached is drawn from them rather
 * than fetched straight back. Rejects with `ImageTooLargeError`, an upload
 * error, or an `AbortError` when `signal` fires.
 */
export async function attachImage(
  file: Blob,
  options: {
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  const { signal } = options;
  const image = await shrinkImage(file);
  // Shrinking takes a while, and the editor may have closed meanwhile.
  signal?.throwIfAborted();
  if (image.size > MAX_IMAGE_SOURCE_BYTES) throw new ImageTooLargeError();
  const stored = await storage.putImage(image, options);
  // Not every adapter can stop a write once it has begun.
  signal?.throwIfAborted();
  if (isStoredImageRef(stored) && !objectUrls.has(stored)) {
    objectUrls.set(stored, Promise.resolve(URL.createObjectURL(image)));
  }
  return stored;
}

/** Test seam: the cache is module state and outlives a test. */
export function forgetAttachmentUrls(): void {
  objectUrls.clear();
}
