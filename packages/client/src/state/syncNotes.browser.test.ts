import {
  type Note,
  NoteColor,
  NoteFont,
  type SyncResponse,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storageConnection } from "../storage/index.js";
import { loadNotes, notes, receiveNote, syncNotes } from "./notesStore.js";

/**
 * Catching up after a reconnect: what changed since the last read, and the
 * ids that say what was taken away. The server is faked at `fetch`, which is
 * where the store meets it.
 */

const SERVER = "https://notes.example.com";

function note(id: string, title = id): Note {
  return {
    id,
    title,
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
    linkPreviews: [],
    reminder: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function sync(body: Partial<SyncResponse>): Response {
  return new Response(
    JSON.stringify({ notes: [], nextCursor: null, ids: [], ...body }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const fetchMock = vi.fn<typeof fetch>();
const asked = () =>
  fetchMock.mock.calls.map((call) => new URL(String(call[0])).search);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  storageConnection.value = { serverUrl: SERVER, token: "tok" };
  notes.value = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  storageConnection.value = { serverUrl: null, token: null };
  notes.value = [];
});

async function loaded(held: Note[]) {
  fetchMock.mockResolvedValueOnce(
    sync({ notes: held, ids: held.map((n) => n.id), checkpoint: "k1" }),
  );
  expect(await loadNotes()).toBe(true);
  fetchMock.mockClear();
}

describe("syncNotes", () => {
  it("asks for what changed since the last read, and takes it in", async () => {
    await loaded([note("a"), note("b")]);
    const unchanged = notes.value.find((n) => n.id === "b");

    fetchMock.mockResolvedValueOnce(
      sync({
        notes: [note("a", "edited"), note("c")],
        ids: ["a", "b", "c"],
        checkpoint: "k2",
      }),
    );
    expect(await syncNotes()).toBe(true);
    expect(asked()).toEqual(["?since=k1"]);
    expect(notes.value.map((n) => n.title).sort()).toEqual([
      "b",
      "c",
      "edited",
    ]);
    // A note the sync did not mention is left exactly as it was held.
    expect(notes.value.find((n) => n.id === "b")).toBe(unchanged);

    fetchMock.mockResolvedValueOnce(
      sync({ ids: ["a", "b", "c"], checkpoint: "k3" }),
    );
    await syncNotes();
    expect(asked().at(-1)).toBe("?since=k2");
  });

  it("drops a held note the ids leave out", async () => {
    await loaded([note("a"), note("gone")]);
    fetchMock.mockResolvedValueOnce(sync({ ids: ["a"], checkpoint: "k2" }));
    await syncNotes();
    expect(notes.value.map((n) => n.id)).toEqual(["a"]);
  });

  it("keeps a note that arrived while the sync was on its way", async () => {
    // Created on the server after it read the ids, so they cannot name it.
    await loaded([note("a")]);
    fetchMock.mockImplementationOnce(async () => {
      receiveNote(note("fresh"));
      return sync({ ids: ["a"], checkpoint: "k2" });
    });
    await syncNotes();
    expect(notes.value.map((n) => n.id).sort()).toEqual(["a", "fresh"]);
  });

  it("reads everything again when the catch-up fails", async () => {
    await loaded([note("a"), note("gone")]);
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 400 }))
      .mockResolvedValueOnce(
        sync({ notes: [note("a")], ids: ["a"], checkpoint: "k9" }),
      );
    expect(await syncNotes()).toBe(true);
    expect(asked()).toEqual(["?since=k1", ""]);
    expect(notes.value.map((n) => n.id)).toEqual(["a"]);
  });

  it("starts from nothing for another account", async () => {
    await loaded([note("a")]);
    storageConnection.value = { serverUrl: SERVER, token: "someone-else" };
    fetchMock.mockResolvedValueOnce(sync({ checkpoint: "k2" }));
    await syncNotes();
    expect(asked()).toEqual([""]);
  });
});
