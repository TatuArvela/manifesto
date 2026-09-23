/**
 * A minimal zip reader for imports: a Google Takeout archive or a zipped
 * Markdown folder. It reads the central directory and inflates entries with
 * the platform's own `DecompressionStream`, so no library ships for a feature
 * most sessions never touch.
 *
 * Only what those archives use is supported: stored (0) and deflated (8)
 * entries, no encryption, no spanning. Zip64 is refused rather than misread;
 * the import cap keeps every legitimate archive well under 4 GB.
 */

export interface ZipEntry {
  /** Path inside the archive, with `/` separators. */
  name: string;
  /** Uncompressed size as the directory records it. */
  size: number;
  /** Rejects if the entry inflates past `limit` bytes. */
  read(limit: number): Promise<Uint8Array>;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
// The end record is 22 bytes plus a comment of up to 65535.
const EOCD_SEARCH = 22 + 0xffff;

/**
 * Inflates one entry, giving up once it passes `limit`. The directory's
 * recorded size is checked first, but it is the archive's own claim; a bomb
 * that understates it is stopped here, before the tab allocates the rest.
 */
async function inflateRaw(
  data: Uint8Array,
  limit: number,
): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error("Zip entry exceeds the size limit");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function isZipFile(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith(".zip") ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed"
  );
}

export async function readZip(blob: Blob): Promise<ZipEntry[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocd = -1;
  const stop = Math.max(0, bytes.length - EOCD_SEARCH);
  for (let i = bytes.length - 22; i >= stop; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("Not a zip archive");

  const count = view.getUint16(eocd + 10, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || dirOffset === 0xffffffff) {
    throw new Error("Zip64 archives are not supported");
  }

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = dirOffset;
  for (let n = 0; n < count; n++) {
    if (
      p + 46 > bytes.length ||
      view.getUint32(p, true) !== CENTRAL_SIGNATURE
    ) {
      throw new Error("Corrupt zip directory");
    }
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue;
    if (flags & 0x1) continue; // encrypted
    if (method !== 0 && method !== 8) continue;

    entries.push({
      name,
      size,
      read: async (limit) => {
        if (size > limit) throw new Error("Zip entry exceeds the size limit");
        if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
          throw new Error("Corrupt zip entry");
        }
        const start =
          localOffset +
          30 +
          view.getUint16(localOffset + 26, true) +
          view.getUint16(localOffset + 28, true);
        const data = bytes.subarray(start, start + compressedSize);
        if (method === 0) {
          if (data.length > limit) {
            throw new Error("Zip entry exceeds the size limit");
          }
          return data;
        }
        return inflateRaw(data, limit);
      },
    });
  }
  return entries;
}
