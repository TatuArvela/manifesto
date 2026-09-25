import { describe, expect, it } from "vitest";
import { readZip, writeZip } from "./zip.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("writeZip", () => {
  it("writes an archive the reader gives back file for file", async () => {
    const zip = await writeZip([
      { name: "notes.json", data: encoder.encode("[]") },
      { name: "notes/Ääkköset.md", data: encoder.encode("# Hei\n".repeat(50)) },
    ]);
    const entries = await readZip(zip);
    expect(entries.map((e) => e.name)).toEqual([
      "notes.json",
      "notes/Ääkköset.md",
    ]);
    expect(decoder.decode(await entries[1].read(10_000))).toBe(
      "# Hei\n".repeat(50),
    );
  });

  it("records each entry's CRC-32, which other unzip tools check", async () => {
    const zip = await writeZip([
      { name: "a.txt", data: encoder.encode("hello") },
    ]);
    const view = new DataView(await zip.arrayBuffer());
    // The local header's checksum field; CRC-32 of "hello" is 0x3610a686.
    expect(view.getUint32(14, true)).toBe(0x3610a686);
  });
});
