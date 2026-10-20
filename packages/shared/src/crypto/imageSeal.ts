import { base64urlToBytes, bytesToBase64url, wipe } from "./bytes.ts";
import { associatedData, sealBytes, sealingKey, unsealBytes } from "./seal.ts";

/**
 * The images of a note, sealed (`docs/specification/features/encryption.md`,
 * "Images"). An image is encrypted before the upload, and the server stores
 * bytes that it cannot read. Its key comes from the account key of the uploader
 * and the bytes of the image. The server finds it by an HMAC of the bytes.
 * Thus, if one account attaches the same image two times, it is one stored
 * item, and its address tells nothing to a person without the key. The key then
 * goes in the note. The sealed list of images contains the id, key and type of
 * each image. Thus, all persons on a shared note can open them.
 */

/** The image types that a note can contain. */
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

/** The address of a sealed image as text: 32 bytes of HMAC as base64url. */
export const IMAGE_ADDRESS_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * What opens one image: its key as base64url, and the image type that the
 * uploader gave. Both go in the note, sealed.
 */
export interface ImageKey {
  key: string;
  type: ImageMediaType;
}

/** The two image keys of an account, derived from its account key. */
export interface ImageKeySource {
  /** Makes the key of an image from its bytes. */
  derive: CryptoKey;
  /** Makes the address under which the server stores and finds an image. */
  address: CryptoKey;
}

const types = new Set<string>(IMAGE_MEDIA_TYPES);

export function isImageMediaType(value: unknown): value is ImageMediaType {
  return typeof value === "string" && types.has(value);
}

/** If `value` is the key and type of an image, as a note can contain them. */
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
 * The image type that the first bytes of a file show, or null. The server does
 * not read images now. Thus, the client that opens an image checks this against
 * the type that the note names. A file cannot arrive as an image and be
 * something different.
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
 * If an ISO BMFF `ftyp` box names AVIF, as its major brand or among the
 * compatible brands. An encoder can start with the generic `mif1` or `miaf`,
 * and list `avif` after it. The size of the box limits the scan.
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
  // Offset 12 is the minor version. The compatible brands follow it.
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

/**
 * Each image is sealed and bound to the same words. Its key is its own, made
 * from its bytes. Thus, there is no other value onto which it could be moved.
 */
const IMAGE_DATA = associatedData({ id: "", field: "image", version: 1 });

/** An image ready for upload. */
export interface SealedImage {
  /** What the server stores. */
  bytes: Uint8Array<ArrayBuffer>;
  /** What the server finds it by, for this account. */
  address: string;
  /** What the note keeps to open it. */
  key: ImageKey;
}

/**
 * Seals an image for upload. Null when the bytes are not one of the image types
 * that a note can contain, whatever their stated type.
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
 * Seals an image under a new random key, for a caller that cannot make one from
 * the account key: the server, when it seals the upload of a token. The server
 * then stores the image one time for each upload, because nothing ties its key
 * to its bytes. Null when the bytes are not an image that a note can contain.
 */
export async function sealImageAtRandom(
  image: Uint8Array<ArrayBuffer>,
): Promise<SealedImage | null> {
  const type = sniffImageType(image);
  if (!type) return null;
  const raw = crypto.getRandomValues(new Uint8Array(32));
  try {
    return {
      bytes: await sealBytes(await sealingKey(raw), image, IMAGE_DATA),
      address: bytesToBase64url(crypto.getRandomValues(new Uint8Array(32))),
      key: { key: bytesToBase64url(raw), type },
    };
  } finally {
    wipe(raw);
  }
}

/**
 * Opens a sealed image with the key that its note has. Null when it does not
 * open, or when the result is not the image type that the note gave. The person
 * who attached it wrote the type, and nothing checked it after that.
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
