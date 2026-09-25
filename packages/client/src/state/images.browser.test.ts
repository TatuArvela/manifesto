import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentStorage, storageConnection } from "../storage/index.js";
import { exportNotes } from "./exportNotes.js";
import { ensureImages, notes } from "./notesStore.js";

/**
 * A server listing sends `imageCount` and an empty `images`, so a note in the
 * signal may be carrying a promise of attachments rather than the attachments.
 * `ensureImages` is what turns one into the other, and everything that needs
 * the bytes (a card scrolling into view, the editor, an export) goes through
 * it. It is also the one place that can turn a note's own pictures into an
 * empty list if it gets the bookkeeping wrong, which is what these check.
 */

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function listed(id: string, imageCount: number): Note {
  return {
    id,
    title: "Holiday",
    content: "",
    color: NoteColor.Default,
    font: NoteFont.Default,
    pinned: false,
    archived: false,
    trashed: false,
    trashedAt: null,
    position: 0,
    tags: [],
    images: [],
    imageCount,
    linkPreviews: [],
    reminder: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

let loadImages: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  notes.value = [];
  loadImages = vi.fn(async () => [PNG]);
  // The adapter is the seam: `ensureImages` asks storage, and open mode
  // answers from what it already has.
  vi.spyOn(currentStorage, "value", "get").mockReturnValue({
    loadImages,
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  storageConnection.value = { serverUrl: null, token: null };
  notes.value = [];
  localStorage.clear();
});

describe("ensureImages", () => {
  it("fetches the attachments a listing left behind and puts them in the note", async () => {
    notes.value = [listed("a", 1)];

    expect(await ensureImages("a")).toEqual([PNG]);
    expect(notes.value[0].images).toEqual([PNG]);
    expect(notes.value[0].imageCount).toBe(1);
  });

  it("does not fetch for a note whose attachments are already there", async () => {
    notes.value = [{ ...listed("a", 1), images: [PNG] }];

    expect(await ensureImages("a")).toEqual([PNG]);
    expect(loadImages).not.toHaveBeenCalled();
  });

  it("does not fetch for a note with no attachments at all", async () => {
    notes.value = [listed("a", 0)];

    expect(await ensureImages("a")).toEqual([]);
    expect(loadImages).not.toHaveBeenCalled();
  });

  it("asks once when a card and the editor over it both ask", async () => {
    // They mount in the same tick, and a note's attachments are the last
    // thing worth fetching twice.
    notes.value = [listed("a", 1)];

    const [first, second] = await Promise.all([
      ensureImages("a"),
      ensureImages("a"),
    ]);
    expect(first).toEqual([PNG]);
    expect(second).toEqual([PNG]);
    expect(loadImages).toHaveBeenCalledTimes(1);
  });

  it("leaves the note alone when the fetch fails", async () => {
    // Reporting a failure and resolving is the contract every action follows;
    // writing an empty list into the note would look like "this note has no
    // pictures" and then get saved back as exactly that.
    loadImages.mockRejectedValue(new Error("offline"));
    notes.value = [listed("a", 2)];

    expect(await ensureImages("a")).toBeNull();
    expect(notes.value[0].images).toEqual([]);
    expect(notes.value[0].imageCount).toBe(2);
  });

  it("answers null for a failure and [] for a note with no attachments", async () => {
    // The whole point of the null: callers write this value back, and the two
    // cases must not look alike. "Could not fetch" reaching a write as an
    // empty list is what deleted a note's pictures.
    notes.value = [listed("empty", 0)];
    expect(await ensureImages("empty")).toEqual([]);

    loadImages.mockRejectedValue(new Error("offline"));
    notes.value = [listed("failing", 2)];
    expect(await ensureImages("failing")).toBeNull();
  });
});

describe("exportNotes", () => {
  it("fetches the attachments a listing left behind before serializing", async () => {
    // The bug this covers: the file downloaded as a full backup, every note in
    // it carrying `images: []`, and importing it back dropped the pictures for
    // good.
    notes.value = [listed("a", 1), listed("b", 1)];

    const exported = await exportNotes();

    expect(exported?.map((n) => n.images)).toEqual([[PNG], [PNG]]);
    expect(loadImages).toHaveBeenCalledTimes(2);
  });

  it("writes nothing at all when an attachment cannot be fetched", async () => {
    // A backup that is silently missing pictures is worse than no backup: the
    // user keeps it, deletes the original, and finds out later.
    loadImages.mockRejectedValue(new Error("offline"));
    notes.value = [listed("a", 3)];

    expect(await exportNotes()).toBeNull();
  });

  it("does not fetch for notes that already have their attachments", async () => {
    notes.value = [{ ...listed("a", 1), images: [PNG] }, listed("b", 0)];

    expect(await exportNotes()).not.toBeNull();
    expect(loadImages).not.toHaveBeenCalled();
  });
});
