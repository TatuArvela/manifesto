import type { Note } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteConflictError, RestApiAdapter } from "./RestApiAdapter.js";

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "01H000000000000000000000A1",
    title: "Test",
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

function lastCallInit(mock: FetchMock, idx = -1): RequestInit {
  const call =
    idx < 0
      ? mock.mock.calls[mock.mock.calls.length + idx]
      : mock.mock.calls[idx];
  return (call?.[1] ?? {}) as RequestInit;
}

describe("RestApiAdapter", () => {
  let fetchMock: FetchMock;
  let adapter: RestApiAdapter;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    adapter = new RestApiAdapter("https://api.example.com", "token-abc");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("construction", () => {
    it("trims a trailing slash from the base URL", async () => {
      const trimmed = new RestApiAdapter("https://api.example.com/", "t");
      fetchMock.mockResolvedValueOnce(jsonResponse({ notes: [] }));
      await trimmed.getAll();
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.com/api/notes",
      );
    });

    it("leaves a base URL without a trailing slash unchanged", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ notes: [] }));
      await adapter.getAll();
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.com/api/notes",
      );
    });
  });

  describe("auth + content-type headers", () => {
    it("sends Bearer token and JSON content-type on every request", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ notes: [] }));
      await adapter.getAll();

      const headers = lastCallInit(fetchMock).headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer token-abc");
      expect(headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("getAll", () => {
    it("returns the notes array from the response envelope", async () => {
      const notes = [makeNote({ id: "A" }), makeNote({ id: "B" })];
      fetchMock.mockResolvedValueOnce(jsonResponse({ notes }));

      const result = await adapter.getAll();
      expect(result).toEqual(notes);
    });

    it("throws when the response is not ok", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("err", { status: 500, statusText: "Server Error" }),
      );
      await expect(adapter.getAll()).rejects.toThrow("Failed to fetch notes");
    });
  });

  describe("get", () => {
    it("returns the note from the response envelope", async () => {
      const note = makeNote({ id: "X" });
      fetchMock.mockResolvedValueOnce(jsonResponse({ note }));

      const result = await adapter.get("X");
      expect(result).toEqual(note);
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.com/api/notes/X",
      );
    });

    it("returns null on 404", async () => {
      fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
      expect(await adapter.get("missing")).toBeNull();
    });

    it("throws on non-404 failures", async () => {
      fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
      await expect(adapter.get("X")).rejects.toThrow("Failed to fetch note");
    });
  });

  describe("create", () => {
    it("POSTs the note and returns the created record", async () => {
      const created = makeNote({ id: "NEW", title: "Hello" });
      fetchMock.mockResolvedValueOnce(jsonResponse({ note: created }));

      const input = {
        title: "Hello",
        content: "",
        color: NoteColor.Blue,
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
      };
      const result = await adapter.create(input);

      expect(result).toEqual(created);
      const init = lastCallInit(fetchMock);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual(input);
    });

    it("throws on failure", async () => {
      fetchMock.mockResolvedValueOnce(new Response("", { status: 400 }));
      await expect(adapter.create({} as never)).rejects.toThrow(
        "Failed to create note",
      );
    });
  });

  describe("update", () => {
    it("PUTs the changes to /api/notes/:id", async () => {
      const updated = makeNote({ id: "X", title: "Renamed" });
      fetchMock.mockResolvedValueOnce(jsonResponse({ note: updated }));

      const result = await adapter.update("X", { title: "Renamed" });
      expect(result).toEqual(updated);
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.com/api/notes/X",
      );
      const init = lastCallInit(fetchMock);
      expect(init.method).toBe("PUT");
      expect(JSON.parse(init.body as string)).toEqual({ title: "Renamed" });
    });

    it("throws on failure", async () => {
      fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
      await expect(adapter.update("X", { title: "y" })).rejects.toThrow(
        "Failed to update note",
      );
    });
  });

  describe("delete", () => {
    it("sends DELETE to /api/notes/:id", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await adapter.delete("X");
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.com/api/notes/X",
      );
      expect(lastCallInit(fetchMock).method).toBe("DELETE");
    });

    it("throws on failure", async () => {
      fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
      await expect(adapter.delete("X")).rejects.toThrow(
        "Failed to delete note",
      );
    });
  });

  describe("deleteAll", () => {
    it("fetches all notes then issues one DELETE per note", async () => {
      const notes = [makeNote({ id: "A" }), makeNote({ id: "B" })];
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ notes }))
        .mockResolvedValue(new Response(null, { status: 204 }));

      await adapter.deleteAll();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      const deleteUrls = fetchMock.mock.calls
        .slice(1)
        .map((c) => c[0])
        .sort();
      expect(deleteUrls).toEqual([
        "https://api.example.com/api/notes/A",
        "https://api.example.com/api/notes/B",
      ]);
    });

    it("is a no-op when there are no notes", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ notes: [] }));
      await adapter.deleteAll();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("importAll", () => {
    it("updates existing notes and creates new ones", async () => {
      const existing = makeNote({ id: "keep", title: "Old" });
      fetchMock.mockResolvedValueOnce(jsonResponse({ notes: [existing] }));

      const updatedVersion = makeNote({ id: "keep", title: "New" });
      const newNote = makeNote({ id: "fresh", title: "Fresh" });

      fetchMock.mockResolvedValueOnce(jsonResponse({ note: updatedVersion }));
      fetchMock.mockResolvedValueOnce(jsonResponse({ note: newNote }));

      await adapter.importAll([updatedVersion, newNote]);

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[1][0]).toBe(
        "https://api.example.com/api/notes/keep",
      );
      expect(lastCallInit(fetchMock, 1).method).toBe("PUT");
      expect(fetchMock.mock.calls[2][0]).toBe(
        "https://api.example.com/api/notes",
      );
      expect(lastCallInit(fetchMock, 2).method).toBe("POST");
    });
  });

  describe("If-Match + conflict handling", () => {
    it("sends If-Match when ifMatch is supplied", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ note: makeNote() }));
      await adapter.update("X", { title: "y" }, { ifMatch: "stamp-1" });
      const headers = lastCallInit(fetchMock).headers as Record<string, string>;
      expect(headers["If-Match"]).toBe("stamp-1");
    });

    it("does not send If-Match when ifMatch is omitted", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ note: makeNote() }));
      await adapter.update("X", { title: "y" });
      const headers = lastCallInit(fetchMock).headers as Record<string, string>;
      expect(headers["If-Match"]).toBeUndefined();
    });

    it("throws NoteConflictError carrying the current note on 412", async () => {
      const current = makeNote({ id: "X", title: "server-side" });
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          { error: "Note has changed", note: current },
          {
            status: 412,
          },
        ),
      );
      try {
        await adapter.update("X", { title: "y" }, { ifMatch: "stale" });
        expect.fail("expected NoteConflictError");
      } catch (err) {
        expect(err).toBeInstanceOf(NoteConflictError);
        expect((err as NoteConflictError).currentNote.title).toBe(
          "server-side",
        );
      }
    });
  });

  describe("error envelope + 401 handling", () => {
    it("surfaces the server's error envelope when present", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Username is already taken" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await expect(adapter.create({} as never)).rejects.toThrow(
        "Username is already taken",
      );
    });

    it("falls back to the generic message when the body is not JSON", async () => {
      fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
      await expect(adapter.getAll()).rejects.toThrow("Failed to fetch notes");
    });

    it("invokes onUnauthorized exactly once when the server returns 401", async () => {
      const onUnauthorized = vi.fn();
      const adapter401 = new RestApiAdapter(
        "https://api.example.com",
        "token-abc",
        { onUnauthorized },
      );
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Session expired" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await expect(adapter401.getAll()).rejects.toThrow("Session expired");
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });

    it("does not invoke onUnauthorized for non-401 errors", async () => {
      const onUnauthorized = vi.fn();
      const adapter500 = new RestApiAdapter(
        "https://api.example.com",
        "token-abc",
        { onUnauthorized },
      );
      fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
      await expect(adapter500.getAll()).rejects.toThrow();
      expect(onUnauthorized).not.toHaveBeenCalled();
    });
  });

  describe("search", () => {
    it("URL-encodes the query parameter", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ notes: [] }));
      await adapter.search("hello world & stuff");
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.com/api/search?q=hello%20world%20%26%20stuff",
      );
    });

    it("returns the notes array from the response envelope", async () => {
      const hits = [makeNote({ id: "hit" })];
      fetchMock.mockResolvedValueOnce(jsonResponse({ notes: hits }));
      expect(await adapter.search("q")).toEqual(hits);
    });

    it("throws on failure", async () => {
      fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
      await expect(adapter.search("q")).rejects.toThrow(
        "Failed to search notes",
      );
    });
  });
});
