import {
  IMAGE_DATA_URL_PATTERN,
  MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES,
} from "@manifesto/shared";

export type PreviewImageKind = "thumbnail" | "favicon";

/**
 * Longest edge, in pixels. A thumbnail fills at most a card-wide hero at 2x;
 * a favicon is drawn at 24px.
 */
const MAX_EDGE: Record<PreviewImageKind, number> = {
  thumbnail: 640,
  favicon: 64,
};

const QUALITIES = [0.8, 0.6, 0.45];

/**
 * Re-encodes an image the server fetched into the small inlined copy a preview
 * stores, or null if it cannot be made to fit.
 *
 * Every stored preview image goes through a canvas, so what is saved is always
 * pixels this browser decoded and encoded itself, whatever bytes the linked
 * site served. Thumbnails prefer WebP and fall back to JPEG where the browser
 * cannot encode WebP (it hands back PNG instead, which is far larger); favicons
 * are PNG, which keeps their transparency and is tiny at this size.
 */
export async function shrinkPreviewImage(
  source: string,
  kind: PreviewImageKind,
): Promise<string | null> {
  let image: HTMLImageElement;
  try {
    image = new Image();
    image.src = source;
    await image.decode();
  } catch {
    return null;
  }
  if (image.naturalWidth === 0 || image.naturalHeight === 0) return null;

  for (let edge = MAX_EDGE[kind]; edge >= 16; edge = Math.floor(edge / 2)) {
    const canvas = drawScaled(image, edge);
    if (!canvas) return null;
    const candidates =
      kind === "favicon"
        ? [canvas.toDataURL("image/png")]
        : encodeThumbnail(canvas, image, edge);
    for (const encoded of candidates) {
      if (
        encoded.length <= MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES &&
        IMAGE_DATA_URL_PATTERN.test(encoded)
      ) {
        return encoded;
      }
    }
  }
  return null;
}

function drawScaled(
  image: HTMLImageElement,
  edge: number,
  background?: string,
): HTMLCanvasElement | null {
  const scale = Math.min(
    1,
    edge / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Lazily yields encodings from best to smallest, so a thumbnail that fits at
 * the first quality is only encoded once. */
function* encodeThumbnail(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  edge: number,
): Generator<string> {
  const webp = canvas.toDataURL("image/webp", QUALITIES[0]);
  if (webp.startsWith("data:image/webp")) {
    yield webp;
    for (const quality of QUALITIES.slice(1)) {
      yield canvas.toDataURL("image/webp", quality);
    }
    return;
  }
  // JPEG has no transparency, and a transparent pixel would otherwise encode
  // as black.
  const flat = drawScaled(image, edge, "#ffffff");
  if (!flat) return;
  for (const quality of QUALITIES) {
    yield flat.toDataURL("image/jpeg", quality);
  }
}
