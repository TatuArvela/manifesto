import { NoteColor, NoteFont } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { MAX_NOTES_PER_RUN, toAutoNoteResults } from "./results.js";

const NOTE = { title: "t", content: "c" };

describe("toAutoNoteResults", () => {
  it("accepts one note per exported function", () => {
    expect(toAutoNoteResults([NOTE, { title: "u", content: "d" }])).toEqual([
      { title: "t", content: "c" },
      { title: "u", content: "d" },
    ]);
  });

  it("flattens a function that returned several notes", () => {
    expect(toAutoNoteResults([[NOTE, NOTE], NOTE])).toHaveLength(3);
  });

  it("accepts a bare note, without the sandbox's array", () => {
    expect(toAutoNoteResults(NOTE)).toEqual([NOTE]);
  });

  it("throws on anything that isn't an object", () => {
    expect(() => toAutoNoteResults(["nope"])).toThrow(/non-object note/);
    expect(() => toAutoNoteResults([null])).toThrow(/non-object note/);
    expect(() => toAutoNoteResults(undefined)).toThrow(/non-object note/);
  });

  it("throws when title or content is missing or the wrong type", () => {
    expect(() => toAutoNoteResults([{ content: "c" }])).toThrow(
      /string title and content/,
    );
    expect(() => toAutoNoteResults([{ title: 1, content: "c" }])).toThrow(
      /string title and content/,
    );
  });

  it("keeps a colour and font the app knows", () => {
    const [note] = toAutoNoteResults([
      { ...NOTE, color: NoteColor.Blue, font: NoteFont.PermanentMarker },
    ]);
    expect(note?.color).toBe(NoteColor.Blue);
    expect(note?.font).toBe(NoteFont.PermanentMarker);
  });

  it("drops a colour or font it doesn't", () => {
    // These index `noteColorMap` / `noteFontFamilies`, and an unrecognized
    // string reaches `undefined` there and throws while a card renders.
    const [note] = toAutoNoteResults([
      { ...NOTE, color: "hotpink", font: "wingdings" },
    ]);
    expect(note?.color).toBeUndefined();
    expect(note?.font).toBeUndefined();
  });

  it("keeps only string tags, capped at 50", () => {
    const [note] = toAutoNoteResults([{ ...NOTE, tags: ["a", 2, null, "b"] }]);
    expect(note?.tags).toEqual(["a", "b"]);

    const [many] = toAutoNoteResults([
      { ...NOTE, tags: Array.from({ length: 80 }, (_, i) => `t${i}`) },
    ]);
    expect(many?.tags).toHaveLength(50);
  });

  it("drops a position that isn't a finite number", () => {
    // Sorted on: one NaN scrambles the order of everything around it.
    expect(
      toAutoNoteResults([{ ...NOTE, position: Number.NaN }])[0]?.position,
    ).toBeUndefined();
    expect(
      toAutoNoteResults([{ ...NOTE, position: Number.POSITIVE_INFINITY }])[0]
        ?.position,
    ).toBeUndefined();
    expect(toAutoNoteResults([{ ...NOTE, position: -3 }])[0]?.position).toBe(
      -3,
    );
  });

  it("drops unknown fields rather than passing them through", () => {
    const [note] = toAutoNoteResults([
      { ...NOTE, readonly: false, id: "generated:evil", images: ["x"] },
    ]);
    expect(note).toEqual(NOTE);
  });

  it("refuses more notes than the cap", () => {
    const many = Array.from({ length: MAX_NOTES_PER_RUN + 1 }, () => NOTE);
    expect(() => toAutoNoteResults(many)).toThrow(/the limit is 100/);
    expect(
      toAutoNoteResults(Array.from({ length: MAX_NOTES_PER_RUN }, () => NOTE)),
    ).toHaveLength(MAX_NOTES_PER_RUN);
  });
});
