/**
 * The regular files of a tar archive (ustar or plain), for Joplin's `.jex`.
 * Hand-written: a tar is 512-byte headers each followed by its file, padded
 * to 512, ending in empty blocks. Only names and sizes are read; links,
 * directories and extended headers are stepped over.
 */
export interface TarEntry {
  name: string;
  bytes: Uint8Array;
}

const BLOCK = 512;
const decoder = new TextDecoder();

function field(block: Uint8Array, start: number, length: number): string {
  const raw = block.subarray(start, start + length);
  const end = raw.indexOf(0);
  return decoder.decode(end === -1 ? raw : raw.subarray(0, end));
}

export function readTar(data: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= data.length) {
    const header = data.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(field(header, 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error("Not a tar archive");
    }
    const type = String.fromCharCode(header[156] ?? 0);
    const prefix = field(header, 345, 155);
    const name = prefix
      ? `${prefix}/${field(header, 0, 100)}`
      : field(header, 0, 100);
    const start = offset + BLOCK;
    if (start + size > data.length) throw new Error("Truncated tar archive");
    if (type === "0" || type === "\0") {
      entries.push({ name, bytes: data.subarray(start, start + size) });
    }
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}
