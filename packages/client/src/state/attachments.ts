import {
  isStoredImageRef,
  type LinkPreview,
  MAX_IMAGE_SOURCE_BYTES,
  mapPreviewImages,
} from "@manifesto/shared";
import { effect } from "@preact/signals";
import { storage, storageConnection } from "#/storage/index.ts";
import { storageKeys } from "#/storage/sealing.ts";
import { blobToDataUrl } from "#/utils/dataUrl.ts";
import { shrinkImage } from "#/utils/shrinkImage.ts";

/**
 * Images that the server keeps in its attachment store reach a note as
 * `attachment:<id>` references. The bytes need the credentials of the session.
 * Thus, an `<img>` cannot point to them. They load one time, and show through a
 * `blob:` URL (which the CSP of the page permits), kept for the session. An id
 * always names one set of bytes. Thus, a cached copy never becomes stale.
 */
const objectUrls = new Map<string, Promise<string | null>>();

// The bytes behind each URL are the opened image. Thus, they go with the
// session and the keys that opened them, as the notes do (`notesStore.ts`).
let cachedFor: { token: string | null; userId: string | null } | null = null;
effect(() => {
  const now = {
    token: storageConnection.value.token,
    userId: storageKeys.value?.userId ?? null,
  };
  const before = cachedFor;
  cachedFor = now;
  if (before && (before.token !== now.token || before.userId !== now.userId)) {
    forgetAttachmentUrls();
  }
});

/**
 * A `blob:` URL that shows the attachment, or null if the client could not read
 * it.
 */
export function attachmentObjectUrl(ref: string): Promise<string | null> {
  let pending = objectUrls.get(ref);
  if (!pending) {
    pending = storage
      .loadImage(ref)
      .then((blob) => URL.createObjectURL(blob))
      .catch(() => {
        // Not cached: the next card that asks tries again.
        objectUrls.delete(ref);
        return null;
      });
    objectUrls.set(ref, pending);
  }
  return pending;
}

/**
 * The images, with each reference replaced by its bytes as a `data:` URL, for
 * all data that goes out of this session: an export, a JSON download. A file
 * that named attachments would be unreadable in all other places. Null if the
 * code could not read one of them, because a backup that silently does not
 * include a picture is worse than no backup.
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
 * The previews, with each thumbnail and favicon inlined, for the same reason as
 * `inlineImages`. The code drops one that it cannot read and keeps the card,
 * because it is a picture of the linked page, not something that the user
 * attached.
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
 * Makes an attached file into something that a note can contain: shrunk to a
 * usable size, checked against the limit, and stored (uploaded in connected
 * mode, with progress reports). The bytes are kept under the reference. Thus,
 * the image that the user just attached is drawn from them, and is not loaded
 * back immediately. Rejects with `ImageTooLargeError`, an upload error, or an
 * `AbortError` when `signal` fires.
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
  // The shrink takes some time, and the editor can have closed in the meantime.
  signal?.throwIfAborted();
  if (image.size > MAX_IMAGE_SOURCE_BYTES) throw new ImageTooLargeError();
  const stored = await storage.putImage(image, options);
  // Not each adapter can stop a write after it started.
  signal?.throwIfAborted();
  if (isStoredImageRef(stored) && !objectUrls.has(stored)) {
    objectUrls.set(stored, Promise.resolve(URL.createObjectURL(image)));
  }
  return stored;
}

/**
 * Releases each image shown so far. Also a test seam: the cache is module
 * state, and stays after a test.
 */
export function forgetAttachmentUrls(): void {
  for (const pending of objectUrls.values()) {
    void pending.then((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }
  objectUrls.clear();
}
