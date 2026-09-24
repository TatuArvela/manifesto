/**
 * A minimal zip reader for imports (a Google Takeout archive, a zipped
 * Markdown folder, an export), and at the end the writer for exports. It
 * reads the central directory and inflates entries with the platform's own
 * `DecompressionStream`, so no library ships for a feature most sessions
 * never touch.
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

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 a zip records for each entry; the reader above never checks
 * it, but every other unzip tool does. */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await new Response(
      new Blob([data as BlobPart])
        .stream()
        .pipeThrough(new CompressionStream("deflate-raw")),
    ).arrayBuffer(),
  );
}

/**
 * A zip archive built in memory, for an open-mode export: the counterpart of
 * the server's `export/zip.ts`, with the platform's `CompressionStream` in
 * place of Node's zlib. Every entry is deflated and dated 1980-01-01, the
 * earliest time the format can say, since the files carry their own dates.
 * No zip64, which one browser's notes never need.
 */
export async function writeZip(
  files: { name: string; data: Uint8Array }[],
): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const dosDate = (1 << 5) | 1;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const compressed = await deflateRaw(file.data);
    const checksum = crc32(file.data);

    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIGNATURE, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 8, true); // deflate
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, compressed.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, name.length, true);
    parts.push(local, name, compressed);

    const entry = new Uint8Array(46);
    const ev = new DataView(entry.buffer);
    ev.setUint32(0, CENTRAL_SIGNATURE, true);
    ev.setUint16(4, 20, true); // made by
    ev.setUint16(6, 20, true); // version needed
    ev.setUint16(8, 0x0800, true);
    ev.setUint16(10, 8, true);
    ev.setUint16(14, dosDate, true);
    ev.setUint32(16, checksum, true);
    ev.setUint32(20, compressed.length, true);
    ev.setUint32(24, file.data.length, true);
    ev.setUint16(28, name.length, true);
    ev.setUint32(42, offset, true);
    central.push(entry, name);

    offset += local.length + name.length + compressed.length;
  }

  const directorySize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, EOCD_SIGNATURE, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end] as BlobPart[], {
    type: "application/zip",
  });
}
