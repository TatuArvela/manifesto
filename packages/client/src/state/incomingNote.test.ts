import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { foldIncoming, foldIncomingList, sameValue } from "./incomingNote.js";

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "Title",
    content: "Body",
    color: NoteColor.Default,
    font: NoteFont.Default,
    pinned: false,
    archived: false,
    trashed: false,
    trashedAt: null,
    position: 0,
    tags: [],
    images: [],
    linkPreviews: [],
    reminder: null,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

describe("sameValue", () => {
  it("compares nested arrays and objects by their contents", () => {
    expect(
      sameValue(
        { a: [1, { b: "x" }], c: null },
        { a: [1, { b: "x" }], c: null },
      ),
    ).toBe(true);
    expect(sameValue({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
    expect(sameValue({ a: [1, 2] }, { a: [1] })).toBe(false);
  });

  it("counts a field one side does not have", () => {
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it("does not mistake null for an object", () => {
    expect(sameValue(null, {})).toBe(false);
    expect(sameValue({}, null)).toBe(false);
  });
});

describe("foldIncoming", () => {
  it("keeps the held note, by reference, when the copy says nothing new", () => {
    const held = makeNote();
    expect(foldIncoming(held, makeNote())).toBe(held);
  });

  it("takes the copy when anything about it differs", () => {
    const held = makeNote();
    const incoming = makeNote({
      title: "Renamed",
      updatedAt: "2026-04-02T00:00:00Z",
    });
    expect(foldIncoming(held, incoming)).toBe(incoming);
  });

  it("takes a note it has never seen", () => {
    const incoming = makeNote();
    expect(foldIncoming(undefined, incoming)).toBe(incoming);
  });

  it("keeps attachments a listing left behind", () => {
    const held = makeNote({ images: ["data:image/png;base64,AAA"] });
    const listed = makeNote({ images: [], imageCount: 1 });
    expect(foldIncoming(held, listed).images).toEqual([
      "data:image/png;base64,AAA",
    ]);
  });

  it("does not resurrect attachments the copy says are gone", () => {
    // A rolled-back write hands back the note as it stood, which may have had
    // no attachments at all. An empty `images` with a count to match is an
    // answer, not a listing that left the bytes behind.
    const held = makeNote({ images: ["data:image/png;base64,AAA"] });
    const withoutAny = makeNote({ images: [], imageCount: 0 });
    expect(foldIncoming(held, withoutAny).images).toEqual([]);
  });

  it("lets go of them once the note has moved on", () => {
    const held = makeNote({ images: ["data:image/png;base64,AAA"] });
    const listed = makeNote({
      images: [],
      imageCount: 2,
      updatedAt: "2026-04-02T00:00:00Z",
    });
    expect(foldIncoming(held, listed).images).toEqual([]);
  });
});

describe("foldIncomingList", () => {
  it("keeps the held list, by reference, when the listing brought nothing", () => {
    const held = [makeNote({ id: "a" }), makeNote({ id: "b" })];
    const listed = [makeNote({ id: "a" }), makeNote({ id: "b" })];
    expect(foldIncomingList(held, listed)).toBe(held);
  });

  it("keeps the identity of the notes that did not change", () => {
    const held = [makeNote({ id: "a" }), makeNote({ id: "b" })];
    const listed = [
      makeNote({ id: "a" }),
      makeNote({
        id: "b",
        title: "Renamed",
        updatedAt: "2026-04-02T00:00:00Z",
      }),
    ];
    const next = foldIncomingList(held, listed);
    expect(next).not.toBe(held);
    expect(next[0]).toBe(held[0]);
    expect(next[1].title).toBe("Renamed");
  });

  it("notices a note that is no longer listed", () => {
    const held = [makeNote({ id: "a" }), makeNote({ id: "b" })];
    const next = foldIncomingList(held, [makeNote({ id: "a" })]);
    expect(next).toHaveLength(1);
    expect(next[0]).toBe(held[0]);
  });
});
