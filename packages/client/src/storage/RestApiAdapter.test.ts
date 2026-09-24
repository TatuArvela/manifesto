import type { Note } from "@manifesto/shared";
import { MAX_NOTES_PER_IMPORT, NoteColor, NoteFont } from "@manifesto/shared";
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

    it("uploads a preview image still inline, and drops one that will not go", async () => {
      const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
      const REF = "attachment:01ARZ3NDEKTSV4RRFFQ69G5FAV";
      const putImage = vi
        .spyOn(adapter, "putImage")
        .mockResolvedValueOnce(REF)
        .mockRejectedValueOnce(new Error("offline"));
      fetchMock.mockResolvedValueOnce(jsonResponse({ note: makeNote() }));
      const card = {
        url: "https://a.test/",
        title: "A",
        domain: "a.test",
      };

      await adapter.update("X", {
        linkPreviews: [{ ...card, image: GIF, favicon: GIF }],
      });

      expect(putImage).toHaveBeenCalledTimes(2);
      expect(JSON.parse(lastCallInit(fetchMock).body as string)).toEqual({
        linkPreviews: [{ ...card, image: REF }],
      });
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
    it("asks the server to delete every note in one request", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await adapter.deleteAll();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.com/api/notes",
      );
      expect(lastCallInit(fetchMock).method).toBe("DELETE");
    });

    it("rejects when the server refuses", async () => {
      fetchMock.mockResolvedValueOnce(new Response("err", { status: 500 }));
      await expect(adapter.deleteAll()).rejects.toThrow(
        "Failed to delete notes",
      );
    });
  });

  describe("importAll", () => {
    it("sends the notes with their ids and creation times", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ created: 1, updated: 0, skipped: 0 }),
      );
      const incoming = makeNote({ id: "fresh", title: "Hi" });

      await adapter.importAll([incoming]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.com/api/notes/import",
      );
      const body = JSON.parse(lastCallInit(fetchMock).body as string) as {
        notes: Record<string, unknown>[];
      };
      expect(body.notes).toHaveLength(1);
      expect(body.notes[0].id).toBe("fresh");
      expect(body.notes[0].createdAt).toBe(incoming.createdAt);
      expect(body.notes[0].updatedAt).toBeUndefined();
      expect(body.notes[0].title).toBe("Hi");
    });

    it("splits a backup larger than one request may carry", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ created: 0, updated: 0, skipped: 0 }),
      );
      const backup = Array.from({ length: MAX_NOTES_PER_IMPORT + 1 }, (_, i) =>
        makeNote({ id: `n${i}` }),
      );

      await adapter.importAll(backup);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("keeps each request under the body limit", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ created: 0, updated: 0, skipped: 0 }),
      );
      const large = "x".repeat(90_000);
      const backup = Array.from({ length: 20 }, (_, i) =>
        makeNote({ id: `n${i}`, content: large }),
      );

      await adapter.importAll(backup);

      for (const index of fetchMock.mock.calls.keys()) {
        const body = lastCallInit(fetchMock, index).body as string;
        expect(body.length).toBeLessThan(1024 * 1024);
      }
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
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

describe("image uploads", () => {
  /** A stand-in for XMLHttpRequest that answers every upload with `status`. */
  function fakeXhr(
    status: number,
    ref = "attachment:01ARZ3NDEKTSV4RRFFQ69G5FAV",
  ) {
    const sent: {
      url: string;
      headers: Record<string, string>;
      body: unknown;
    }[] = [];
    class FakeXhr {
      status = 0;
      responseText = "";
      upload: { onprogress?: (e: ProgressEvent) => void } = {};
      onload?: () => void;
      onerror?: () => void;
      onabort?: () => void;
      private url = "";
      private headers: Record<string, string> = {};
      open(_method: string, url: string) {
        this.url = url;
      }
      setRequestHeader(name: string, value: string) {
        this.headers[name] = value;
      }
      abort() {
        this.onabort?.();
      }
      send(body: unknown) {
        sent.push({ url: this.url, headers: this.headers, body });
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: 1,
          total: 2,
        } as ProgressEvent);
        this.status = status;
        this.responseText = JSON.stringify({ ref });
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    return sent;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("uploads the raw image with its type and reports progress", async () => {
    const sent = fakeXhr(201);
    const adapter = new RestApiAdapter("https://notes.example", "t");
    const progress: number[] = [];
    const ref = await adapter.putImage(
      new Blob([new Uint8Array([1, 2])], { type: "image/png" }),
      { onProgress: (p) => progress.push(p) },
    );
    expect(ref).toBe("attachment:01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(sent[0].url).toBe("https://notes.example/api/attachments");
    expect(sent[0].headers).toMatchObject({
      Authorization: "Bearer t",
      "Content-Type": "image/png",
    });
    expect(progress).toEqual([0.5]);
  });

  it("rejects an upload the server refuses", async () => {
    fakeXhr(415);
    const adapter = new RestApiAdapter("https://notes.example", "t");
    await expect(
      adapter.putImage(new Blob([], { type: "image/png" })),
    ).rejects.toMatchObject({ status: 415 });
  });

  it("uploads an image left inline before writing the note", async () => {
    fakeXhr(201);
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ note: makeNote() }, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new RestApiAdapter("https://notes.example", "t");
    const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = makeNote();
    await adapter.create({
      ...fields,
      images: [
        "data:image/png;base64,AQI=",
        "attachment:01BBBBBBBBBBBBBBBBBBBBBBBB",
      ],
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.images).toEqual([
      "attachment:01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "attachment:01BBBBBBBBBBBBBBBBBBBBBBBB",
    ]);
  });
});
