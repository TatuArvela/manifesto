import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { mergeNoteUpdate } from "./mergeNote.js";

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

describe("mergeNoteUpdate", () => {
  it("preserves both sides' tag additions", () => {
    const base = makeNote({ tags: ["common"] });
    const desired = { tags: ["common", "alice-tag"] };
    const current = makeNote({ tags: ["common", "bob-tag"] });
    expect(mergeNoteUpdate(base, desired, current).tags).toEqual([
      "common",
      "bob-tag",
      "alice-tag",
    ]);
  });

  it("removes a tag the local user explicitly removed", () => {
    const base = makeNote({ tags: ["common", "doomed"] });
    const desired = { tags: ["common"] };
    const current = makeNote({ tags: ["common", "doomed", "bob-tag"] });
    expect(mergeNoteUpdate(base, desired, current).tags).toEqual([
      "common",
      "bob-tag",
    ]);
  });

  it("client wins on scalar fields", () => {
    const base = makeNote({ title: "Old" });
    const desired = { title: "Renamed" };
    const current = makeNote({ title: "Concurrent rename" });
    expect(mergeNoteUpdate(base, desired, current).title).toBe("Renamed");
  });

  it("dedupes link previews by url", () => {
    const base = makeNote({ linkPreviews: [] });
    const desired = {
      linkPreviews: [{ url: "https://a", title: "A", domain: "a" }],
    };
    const current = makeNote({
      linkPreviews: [{ url: "https://a", title: "A bob", domain: "a" }],
    });
    const merged = mergeNoteUpdate(base, desired, current).linkPreviews ?? [];
    expect(merged.map((p) => p.url)).toEqual(["https://a"]);
  });

  it("propagates the user's edits to existing link preview metadata", () => {
    const existing = { url: "https://a", title: "Old title", domain: "a" };
    const updated = { url: "https://a", title: "New title", domain: "a" };
    const base = makeNote({ linkPreviews: [existing] });
    const desired = { linkPreviews: [updated] };
    const current = makeNote({ linkPreviews: [existing] });
    const merged = mergeNoteUpdate(base, desired, current).linkPreviews ?? [];
    expect(merged).toEqual([updated]);
  });

  it("leaves untouched fields out of the merge result", () => {
    const base = makeNote({ tags: ["x"] });
    const desired = { tags: ["x", "y"] };
    const current = makeNote({ tags: ["x"], color: NoteColor.Red });
    const merged = mergeNoteUpdate(base, desired, current);
    expect(merged.tags).toEqual(["x", "y"]);
    expect("color" in merged).toBe(false);
  });
});
