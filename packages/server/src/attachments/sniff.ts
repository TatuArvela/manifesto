/**
 * The image type a file's leading bytes say it is, or null. An upload is
 * stored only when this agrees with the type it was sent as, and is served
 * back with that type and `nosniff`, so a file cannot arrive as an image and
 * be something else.
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
  if (ascii(4, "ftyp") && (ascii(8, "avif") || ascii(8, "avis"))) {
    return "image/avif";
  }
  return null;
}
