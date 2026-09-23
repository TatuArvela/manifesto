import { isAttachmentRef } from "@manifesto/shared";
import { createStorage } from "../storage/index.js";

const storage = createStorage();

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
      .loadAttachment(ref)
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

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
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
    if (!isAttachmentRef(image)) {
      out.push(image);
      continue;
    }
    try {
      const dataUrl = await blobToDataUrl(await storage.loadAttachment(image));
      if (dataUrl === null) return null;
      out.push(dataUrl);
    } catch {
      return null;
    }
  }
  return out;
}

/** Test seam: the cache is module state and outlives a test. */
export function forgetAttachmentUrls(): void {
  objectUrls.clear();
}
