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

    it("builds relative paths from an empty base, for a same-origin server", async () => {
      // What `/` resolves to. `fetch` takes it from here against the page, so
      // the client needs no hostname of its own and cannot have a stale one.
      const sameOrigin = new RestApiAdapter("", "t");
      fetchMock.mockResolvedValueOnce(jsonResponse({ notes: [] }));
      await sameOrigin.getAll();
      expect(fetchMock.mock.calls[0][0]).toBe("/api/notes");
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

    it("continues past individual failures and aggregates them", async () => {
      const notes = [
        makeNote({ id: "A" }),
        makeNote({ id: "B" }),
        makeNote({ id: "C" }),
      ];
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ notes }))
        // A: success
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        // B: 500, but the loop must continue
        .mockResolvedValueOnce(new Response("err", { status: 500 }))
        // C: success
        .mockResolvedValueOnce(new Response(null, { status: 204 }));

      await expect(adapter.deleteAll()).rejects.toThrow(
        "Failed to delete some notes",
      );
      // 1 list + 3 deletes confirms B's failure didn't short-circuit C.
      expect(fetchMock).toHaveBeenCalledTimes(4);
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

    it("strips server-assigned fields from the payload", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ notes: [] }));
      const incoming = makeNote({ id: "fresh", title: "Hi" });
      fetchMock.mockResolvedValueOnce(jsonResponse({ note: incoming }));

      await adapter.importAll([incoming]);

      const createBody = JSON.parse(
        lastCallInit(fetchMock, 1).body as string,
      ) as Record<string, unknown>;
      expect(createBody.id).toBeUndefined();
      expect(createBody.createdAt).toBeUndefined();
      expect(createBody.updatedAt).toBeUndefined();
      expect(createBody.title).toBe("Hi");
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

  describe("paging", () => {
    // The app keeps every note in one signal (`allTags`, the tag counts and
    // the whole filter chain are computed over the full list), so pages are a
    // property of the wire and the adapter hands the caller all of them.

    it("follows the cursor until the server stops offering one", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            notes: [makeNote({ id: "a" })],
            nextCursor: "cur-1",
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            notes: [makeNote({ id: "b" })],
            nextCursor: null,
          }),
        );

      expect((await adapter.getAll()).map((n) => n.id)).toEqual(["a", "b"]);
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.com/api/notes",
      );
      expect(fetchMock.mock.calls[1][0]).toBe(
        "https://api.example.com/api/notes?cursor=cur-1",
      );
    });

    it("joins the cursor onto a query string that already exists", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ notes: [makeNote({ id: "a" })], nextCursor: "c" }),
        )
        .mockResolvedValueOnce(jsonResponse({ notes: [], nextCursor: null }));

      await adapter.search("cats");
      expect(fetchMock.mock.calls[1][0]).toBe(
        "https://api.example.com/api/search?q=cats&cursor=c",
      );
    });

    it("stops on an empty page rather than following its cursor", async () => {
      // A page with nothing in it cannot be followed by a useful one, and a
      // server that kept handing back the same cursor would spin forever.
      fetchMock.mockResolvedValue(
        jsonResponse({ notes: [], nextCursor: "same-cursor-again" }),
      );
      expect(await adapter.getAll()).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("loadImages", () => {
    it("reads the attachments a listing left behind", async () => {
      const png = "data:image/png;base64,iVBORw0KGgo=";
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ note: makeNote({ id: "a", images: [png] }) }),
      );
      expect(await adapter.loadImages("a")).toEqual([png]);
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.com/api/notes/a",
      );
    });

    it("answers with nothing for a note that is gone", async () => {
      fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
      expect(await adapter.loadImages("gone")).toEqual([]);
    });
  });

  describe("fetchLinkPreview", () => {
    it("asks the server for the encoded URL with the session token", async () => {
      const preview = {
        url: "https://example.com/a?b=c&d",
        title: "A",
        domain: "example.com",
      };
      fetchMock.mockResolvedValueOnce(jsonResponse({ preview }));

      expect(await adapter.fetchLinkPreview(preview.url)).toEqual(preview);
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.com/api/link-preview?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc%26d",
      );
      const headers = lastCallInit(fetchMock).headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer token-abc");
    });

    it("passes on a null preview for a page the server could not fetch", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ preview: null }));
      expect(await adapter.fetchLinkPreview("https://down.test/")).toBeNull();
    });

    it("reads previews being turned off on the server as no preview", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: "disabled" }, { status: 404 }),
      );
      expect(await adapter.fetchLinkPreview("https://a.test/")).toBeNull();
    });

    it("throws on other failures, and reports a 401", async () => {
      const onUnauthorized = vi.fn();
      const withHook = new RestApiAdapter("https://api.example.com", "t", {
        onUnauthorized,
      });
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: "Unauthorized" }, { status: 401 }),
      );
      await expect(
        withHook.fetchLinkPreview("https://a.test/"),
      ).rejects.toThrow("Unauthorized");
      expect(onUnauthorized).toHaveBeenCalledOnce();

      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: "Too many requests" }, { status: 429 }),
      );
      await expect(adapter.fetchLinkPreview("https://a.test/")).rejects.toThrow(
        "Too many requests",
      );
    });
  });
});
