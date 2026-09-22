import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { createPendingWrites } from "./pendingWrites.js";

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

describe("pendingWrites", () => {
  it("shows the change before anything has been sent", () => {
    const writes = createPendingWrites();
    expect(writes.begin(makeNote(), { pinned: true }).pinned).toBe(true);
    expect(writes.pending("n1")).toBe(true);
  });

  it("hands back a server copy untouched when nothing is outstanding", () => {
    const writes = createPendingWrites();
    const truth = makeNote();
    expect(writes.replay(truth)).toBe(truth);
  });

  it("replays a write the server has not answered yet", () => {
    const writes = createPendingWrites();
    const changes = { pinned: true };
    writes.begin(makeNote(), changes);
    // Another device's edit arrives while our pin is still in the air.
    const elsewhere = makeNote({
      title: "Renamed",
      updatedAt: "2026-04-02T00:00:00Z",
    });
    const shown = writes.replay(elsewhere);
    expect(shown.title).toBe("Renamed");
    expect(shown.pinned).toBe(true);
  });

  it("stops replaying a write once it is settled", () => {
    const writes = createPendingWrites();
    const changes = { pinned: true };
    writes.begin(makeNote(), changes);
    writes.settle("n1", changes);
    expect(writes.pending("n1")).toBe(false);
    expect(writes.replay(makeNote()).pinned).toBe(false);
  });

  it("does not let an older answer undo a newer click", () => {
    const writes = createPendingWrites();
    const note = makeNote();
    const first = { color: NoteColor.Blue };
    const second = { color: NoteColor.Green };
    writes.begin(note, first);
    writes.begin(note, second);

    // The first write's answer lands; the second is still outstanding.
    writes.settle("n1", first);
    const answered = makeNote({
      color: NoteColor.Blue,
      updatedAt: "2026-04-02T00:00:00Z",
    });
    expect(writes.replay(answered).color).toBe(NoteColor.Green);
  });

  it("settles the write it was given, not the one that was sent", () => {
    const writes = createPendingWrites();
    const changes = { tags: ["one"] };
    writes.begin(makeNote(), changes);
    // A conflict retry sends a merged set of changes and settles the original.
    writes.settle("n1", changes);
    expect(writes.pending("n1")).toBe(false);
  });
});
