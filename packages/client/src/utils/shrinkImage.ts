import { IMAGE_DATA_URL_SUBTYPES } from "@manifesto/shared";

/** Longest edge an attached photo is kept at, in pixels. */
export const MAX_IMAGE_EDGE = 2560;
/** Below this, an image inside the edge is kept exactly as it came. */
const KEEP_AS_IS_BYTES = 1024 * 1024;
const QUALITY = 0.85;

const ACCEPTED = new Set<string>(IMAGE_DATA_URL_SUBTYPES);

/**
 * Makes an attached image a sensible size before it is stored: a phone photo
 * is 4000 pixels across and several megabytes, far more than a card or the
 * viewer shows, and every copy of it is paid for in uploads, storage and
 * backups.
 *
 * - An image within `MAX_IMAGE_EDGE` and under a megabyte is kept as it is.
 *   Screenshots and small images stay byte for byte, PNGs stay PNG.
 * - A larger one is redrawn through a canvas at most `MAX_IMAGE_EDGE` on its
 *   long edge and re-encoded: PNG stays PNG (lossless, so text stays crisp),
 *   anything else becomes WebP, or JPEG where the browser cannot encode WebP.
 *   The redraw also drops the photo's EXIF data (camera, location).
 * - A GIF is left alone, since redrawing it would stop the animation.
 *
 * An image over the edge is always redrawn; one within it but heavy is
 * re-encoded only if that makes it smaller. An image the browser cannot
 * decode comes back unchanged, for the size check to judge.
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
    // Past the edge, the redrawn copy is the point, whatever its bytes; within
    // it (a heavy image of modest size), only a copy that is smaller helps.
    return longEdge > MAX_IMAGE_EDGE || encoded.size < image.size
      ? encoded
      : image;
  } finally {
    bitmap.close();
  }
}

/** A canvas as `type`, or null if the browser produced another type (a
 * browser that cannot encode WebP hands back PNG, which is far larger). */
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
