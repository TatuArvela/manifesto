/**
 * The image type a file's leading bytes say it is, or null. An upload is
 * stored as this type whatever it was sent as, and is served back with it
 * and `nosniff`, so a file cannot arrive as an image and be something else.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
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
