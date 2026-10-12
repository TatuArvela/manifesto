import { base64urlToBytes, bytesToBase64url, wipe } from "./bytes.js";
import { associatedData, sealBytes, sealingKey, unsealBytes } from "./seal.js";

/**
 * A note's images, sealed (`docs/specification/features/encryption.md`,
 * "Images"). An image is encrypted before it is uploaded and the server
 * stores bytes it cannot read. Its key comes from the uploader's account key
 * and the image's own bytes, and it is found by an HMAC of the bytes, so the
 * same image attached twice by one account is one stored thing whose address
 * says nothing to anyone without the key. The key then travels in the note:
 * the sealed list of images holds each one's id, key and type, which is how
 * everyone on a shared note opens them.
 */

/** The image types a note may hold. */
export const IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;

export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/** How much longer a sealed image is than the image: a nonce and a tag. */
export const SEALED_IMAGE_OVERHEAD = 28;

/** A sealed image's address as text: 32 bytes of HMAC as base64url. */
export const IMAGE_ADDRESS_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** What opens one image: its key as base64url, and what kind of image the
 * uploader said it is. Both ride in the note, sealed. */
export interface ImageKey {
  key: string;
  type: ImageMediaType;
}

/** An account's two keys for images, derived from its account key. */
export interface ImageKeySource {
  /** Makes an image's key from its bytes. */
  derive: CryptoKey;
  /** Makes the address an image is stored and found under. */
  address: CryptoKey;
}

const types = new Set<string>(IMAGE_MEDIA_TYPES);

export function isImageMediaType(value: unknown): value is ImageMediaType {
  return typeof value === "string" && types.has(value);
}

/** Whether `value` is an image's key and type as a note may hold them. */
export function isImageKey(value: unknown): value is ImageKey {
  if (typeof value !== "object" || value === null) return false;
  const { key, type } = value as Partial<ImageKey>;
  return (
    typeof key === "string" &&
    IMAGE_ADDRESS_PATTERN.test(key) &&
    isImageMediaType(type)
  );
}

/**
 * The image type a file's leading bytes say it is, or null. The server no
 * longer reads an image, so this is checked by the client that opens one,
 * against the type the note names: a file cannot arrive as an image and be
 * something else.
 */
export function sniffImageType(bytes: Uint8Array): ImageMediaType | null {
  const at = (offset: number, ...values: number[]) =>
    values.every((v, i) => bytes[offset + i] === v);
  const ascii = (offset: number, text: string) =>
    at(offset, ...[...text].map((c) => c.charCodeAt(0)));
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(4, "ftyp") && isAvifBrand(bytes, ascii)) return "image/avif";
  return null;
}

/**
 * Whether an ISO BMFF `ftyp` box names AVIF, as its major brand or among the
 * compatible ones: an encoder may lead with the generic `mif1` or `miaf` and
 * list `avif` after it. The box's own size bounds the scan.
 */
function isAvifBrand(
  bytes: Uint8Array,
  ascii: (offset: number, text: string) => boolean,
): boolean {
  const size =
    ((bytes[0] ?? 0) << 24) |
    ((bytes[1] ?? 0) << 16) |
    ((bytes[2] ?? 0) << 8) |
    (bytes[3] ?? 0);
  const end = Math.min(size >>> 0, bytes.length, 256);
  const isAvif = (offset: number) =>
    ascii(offset, "avif") || ascii(offset, "avis");
  if (isAvif(8)) return true;
  // Offset 12 is the minor version; the compatible brands follow it.
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (isAvif(offset)) return true;
  }
  return false;
}

async function hmac(
  key: CryptoKey,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
}

/** Every image is sealed bound to the same words: its key is its own, made
 * from its bytes, so there is no other value it could be moved onto. */
const IMAGE_DATA = associatedData({ id: "", field: "image", version: 1 });

/** An image ready to upload. */
export interface SealedImage {
  /** What the server stores. */
  bytes: Uint8Array<ArrayBuffer>;
  /** What the server finds it by, for this account. */
  address: string;
  /** What the note keeps to open it with. */
  key: ImageKey;
}

/**
 * Seals an image for upload. Null when the bytes are not one of the image
 * types a note may hold, whatever they were handed over as.
 */
export async function sealImage(
  source: ImageKeySource,
  image: Uint8Array<ArrayBuffer>,
): Promise<SealedImage | null> {
  const type = sniffImageType(image);
  if (!type) return null;
  const raw = await hmac(source.derive, image);
  try {
    return {
      bytes: await sealBytes(await sealingKey(raw), image, IMAGE_DATA),
      address: bytesToBase64url(await hmac(source.address, image)),
      key: { key: bytesToBase64url(raw), type },
    };
  } finally {
    wipe(raw);
  }
}

/**
 * Opens a sealed image with the key its note holds. Null when it does not
 * open, or when what comes out is not the kind of image the note said: the
 * type was written by whoever attached it, and nothing checked it since.
 */
export async function openImage(
  key: ImageKey,
  sealed: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!isImageKey(key)) return null;
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = base64urlToBytes(key.key);
  } catch {
    return null;
  }
  try {
    const image = await unsealBytes(await sealingKey(raw), sealed, IMAGE_DATA);
    if (!image || sniffImageType(image) !== key.type) return null;
    return image;
  } catch {
    return null;
  } finally {
    wipe(raw);
  }
}
