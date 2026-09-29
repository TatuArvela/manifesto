import { describe, expect, it } from "vitest";
import { readTar } from "./tar.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface Member {
  name: string;
  content?: string;
  type?: string;
  prefix?: string;
  /** Overrides the size field, to write a header that lies. */
  size?: string;
}

function header({ name, content = "", type = "0", prefix = "", size }: Member) {
  const block = new Uint8Array(512);
  block.set(encoder.encode(name).subarray(0, 100), 0);
  const length = encoder.encode(content).length;
  block.set(
    encoder.encode(size ?? `${length.toString(8).padStart(11, "0")}\0`),
    124,
  );
  block[156] = type.charCodeAt(0);
  block.set(encoder.encode(prefix).subarray(0, 155), 345);
  return block;
}

/** A tar in memory, ended by the two empty blocks a real one carries. */
function tar(members: Member[], { end = true } = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const member of members) {
    parts.push(header(member));
    const body = encoder.encode(member.content ?? "");
    const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
    padded.set(body);
    parts.push(padded);
  }
  if (end) parts.push(new Uint8Array(1024));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function read(data: Uint8Array) {
  return readTar(data).map((e) => ({
    name: e.name,
    text: decoder.decode(e.bytes),
  }));
}

describe("readTar", () => {
  it("reads each regular file's name and bytes, across block boundaries", () => {
    const long = "x".repeat(700);
    expect(
      read(
        tar([
          { name: "a.md", content: "hello" },
          { name: "b.md", content: long },
          { name: "empty.md" },
        ]),
      ),
    ).toEqual([
      { name: "a.md", text: "hello" },
      { name: "b.md", text: long },
      { name: "empty.md", text: "" },
    ]);
  });

  it("steps over directories, links and extended headers", () => {
    expect(
      read(
        tar([
          { name: "dir/", type: "5" },
          { name: "link", type: "2" },
          {
            name: "PaxHeader",
            type: "x",
            content: "30 path=very/long/name.md\n",
          },
          { name: "kept.md", content: "k" },
        ]),
      ),
    ).toEqual([{ name: "kept.md", text: "k" }]);
  });

  it("takes a file of an old tar with no type as a regular file", () => {
    expect(read(tar([{ name: "old.md", content: "o", type: "\0" }]))).toEqual([
      { name: "old.md", text: "o" },
    ]);
  });

  it("joins a ustar prefix onto the name", () => {
    expect(
      read(tar([{ name: "note.md", prefix: "resources/deep", content: "n" }])),
    ).toEqual([{ name: "resources/deep/note.md", text: "n" }]);
  });

  it("stops at the end blocks, and reads an archive that has none", () => {
    const withTrailingJunk = new Uint8Array([
      ...tar([{ name: "a.md", content: "a" }]),
      ...header({ name: "after-end.md" }),
    ]);
    expect(read(withTrailingJunk).map((e) => e.name)).toEqual(["a.md"]);
    expect(read(tar([{ name: "a.md", content: "a" }], { end: false }))).toEqual(
      [{ name: "a.md", text: "a" }],
    );
    expect(readTar(new Uint8Array(0))).toEqual([]);
    expect(readTar(new Uint8Array(100))).toEqual([]);
  });

  it("refuses a file that claims more bytes than the archive holds", () => {
    const truncated = tar([{ name: "a.md", content: "x".repeat(600) }]).slice(
      0,
      512 + 512,
    );
    expect(() => readTar(truncated)).toThrow("Truncated tar archive");
    expect(() =>
      readTar(tar([{ name: "big.md", size: "77777777777\0" }])),
    ).toThrow("Truncated tar archive");
  });

  it("refuses a header whose size is not a number", () => {
    expect(() =>
      readTar(tar([{ name: "a.md", size: "not octal!!\0" }])),
    ).toThrow("Not a tar archive");
  });
});
