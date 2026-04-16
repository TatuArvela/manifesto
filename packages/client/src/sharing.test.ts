import { NoteColor, NoteFont } from "@manifesto/shared";
import { compressToEncodedURIComponent } from "lz-string";
import { describe, expect, it } from "vitest";
import {
  decodeShareFromHash,
  encodeSharePayload,
  type SharedNotePayload,
} from "./sharing.js";

const samplePayload: SharedNotePayload = {
  title: "Shopping list",
  content: "- [ ] Milk\n- [x] Eggs",
  color: NoteColor.Yellow,
  font: NoteFont.Default,
  tags: ["personal", "groceries"],
};

describe("encodeSharePayload / decodeShareFromHash", () => {
  it("round-trips a payload through encode and decode", () => {
    const hash = `#${encodeSharePayload(samplePayload)}`;
    const result = decodeShareFromHash(hash);
    expect(result).toEqual(samplePayload);
  });

  it("round-trips a payload with empty fields", () => {
    const emptyPayload: SharedNotePayload = {
      title: "",
      content: "",
      color: NoteColor.Default,
      font: NoteFont.Default,
      tags: [],
    };
    const hash = `#${encodeSharePayload(emptyPayload)}`;
    const result = decodeShareFromHash(hash);
    expect(result).toEqual(emptyPayload);
  });

  it("round-trips a payload with unicode content", () => {
    const unicodePayload: SharedNotePayload = {
      title: "Notas en espanol",
      content: "Cafe con leche y croissant",
      color: NoteColor.Orange,
      font: NoteFont.ComicRelief,
      tags: ["cafe"],
    };
    const hash = `#${encodeSharePayload(unicodePayload)}`;
    const result = decodeShareFromHash(hash);
    expect(result).toEqual(unicodePayload);
  });
});

describe("decodeShareFromHash", () => {
  it("returns null for empty hash", () => {
    expect(decodeShareFromHash("")).toBeNull();
  });

  it("returns null for hash without share prefix", () => {
    expect(decodeShareFromHash("#settings")).toBeNull();
  });

  it("returns null for #share= with no payload", () => {
    expect(decodeShareFromHash("#share=")).toBeNull();
  });

  it("returns null for corrupted payload", () => {
    expect(decodeShareFromHash("#share=not-valid-data!!!")).toBeNull();
  });

  it("returns null for valid JSON that is not a note payload", () => {
    const bad = compressToEncodedURIComponent(JSON.stringify({ foo: "bar" }));
    expect(decodeShareFromHash(`#share=${bad}`)).toBeNull();
  });

  it("returns null for payload missing required fields", () => {
    const partial = compressToEncodedURIComponent(
      JSON.stringify({ title: "hi", content: "hello" }),
    );
    expect(decodeShareFromHash(`#share=${partial}`)).toBeNull();
  });
});
