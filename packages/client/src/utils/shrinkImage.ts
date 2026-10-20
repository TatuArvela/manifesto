import { IMAGE_DATA_URL_SUBTYPES } from "@manifesto/shared";

/** The longest edge at which the app keeps an attached photo, in pixels. */
export const MAX_IMAGE_EDGE = 2560;
/** Below this, an image inside the edge is kept exactly as it came. */
const KEEP_AS_IS_BYTES = 1024 * 1024;
const QUALITY = 0.85;

const ACCEPTED = new Set<string>(IMAGE_DATA_URL_SUBTYPES);

/**
 * Gives an attached image a usable size before it is stored. A phone photo is
 * 4000 pixels across and several megabytes, much more than a card or the viewer
 * shows, and each copy of it costs uploads, storage and backups.
 *
 * - An image within `MAX_IMAGE_EDGE` and under one megabyte is kept as it is.
 *   Screenshots and small images stay byte for byte, and PNGs stay PNG.
 * - A larger image is drawn again through a canvas, at a maximum of
 *   `MAX_IMAGE_EDGE` on its long edge, and encoded again. PNG stays PNG
 *   (lossless, so that text stays sharp). All other types become WebP, or JPEG
 *   where the browser cannot encode WebP. The new draw also drops the EXIF data
 *   of the photo (camera, location).
 * - The code does not change a GIF, because a new draw would stop the
 *   animation.
 *
 * An image over the edge is always drawn again. An image within it, but large,
 * is encoded again only if that makes it smaller. An image that the browser
 * cannot decode comes back unchanged, and the size check decides about it.
 */
export async function shrinkImage(image: Blob): Promise<Blob> {
  const subtype = image.type.replace(/^image\//, "").toLowerCase();
  if (!ACCEPTED.has(subtype) || subtype === "gif") return image;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image);
  } catch {
    return image;
  }
  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (longEdge <= MAX_IMAGE_EDGE && image.size <= KEEP_AS_IS_BYTES) {
      return image;
    }
    const scale = Math.min(1, MAX_IMAGE_EDGE / longEdge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return image;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const encoded =
      subtype === "png"
        ? await encode(canvas, "image/png")
        : ((await encode(canvas, "image/webp", QUALITY)) ??
          (await encode(canvas, "image/jpeg", QUALITY)));
    if (!encoded) return image;
    // Past the edge, the new copy is the purpose, whatever its bytes. Within it
    // (a large image of usual dimensions), only a smaller copy helps.
    return longEdge > MAX_IMAGE_EDGE || encoded.size < image.size
      ? encoded
      : image;
  } finally {
    bitmap.close();
  }
}

/**
 * A canvas as `type`, or null if the browser made a different type (a browser
 * that cannot encode WebP gives back PNG, which is much larger).
 */
function encode(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob && blob.type === type ? blob : null),
      type,
      quality,
    );
  });
}
