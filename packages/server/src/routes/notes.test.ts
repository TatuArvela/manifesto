import type { Note, NoteCreate, NotesResponse } from "@manifesto/shared";
import {
  MAX_IMAGE_DATA_URL_BYTES,
  MAX_IMAGE_SOURCE_BYTES,
  NoteColor,
  NoteFont,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";

const baseNote: NoteCreate = {
  title: "",
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
};

async function createNote(
  rig: TestRig,
  token: string,
  overrides: Partial<NoteCreate> = {},
): Promise<Note> {
  const res = await rig.request("/api/notes", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ ...baseNote, ...overrides }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { note: Note };
  return body.note;
}

async function putNote(
  rig: TestRig,
  token: string,
  id: string,
  changes: Record<string, unknown>,
): Promise<Note> {
  const res = await rig.request(`/api/notes/${id}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(changes),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { note: Note };
  return body.note;
}

describe("notes routes", () => {
  let rig: TestRig;

  beforeEach(async () => {
    rig = await bootTestApp();
  });

  afterEach(async () => {
    await rig.close();
  });

  it("returns 401 when no token is supplied", async () => {
    const res = await rig.request("/api/notes");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns an empty notes list for a fresh user", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const res = await rig.request("/api/notes", {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notes: [], nextCursor: null });
  });

  it("creates a note with server-assigned id and timestamps", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const note = await createNote(rig, token, {
      title: "Hello",
      content: "World",
      color: NoteColor.Yellow,
      tags: ["greeting"],
    });
    expect(note.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(note.title).toBe("Hello");
    expect(note.tags).toEqual(["greeting"]);
    expect(note.createdAt).toMatch(/T.*Z$/);
    expect(note.updatedAt).toBe(note.createdAt);
  });

  it("retrieves an existing note by id", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const note = await createNote(rig, token, { title: "Found me" });
    const res = await rig.request(`/api/notes/${note.id}`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ note });
  });

  it("returns 404 for unknown note ids", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const res = await rig.request("/api/notes/missing", {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
  });

  it("isolates notes per user", async () => {
    const { token: alice } = await registerTestUser(rig, "alice");
    const { token: bob } = await registerTestUser(rig, "bob");

    const aliceNote = await createNote(rig, alice, { title: "Alice's" });

    const res = await rig.request(`/api/notes/${aliceNote.id}`, {
      headers: authHeaders(bob),
    });
    expect(res.status).toBe(404);

    const list = await rig.request("/api/notes", { headers: authHeaders(bob) });
    expect(await list.json()).toEqual({ notes: [], nextCursor: null });
  });

  it("updates a partial set of fields and bumps updatedAt", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const note = await createNote(rig, token, { title: "Old" });
    await new Promise((r) => setTimeout(r, 5));
    const res = await rig.request(`/api/notes/${note.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ title: "New" }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { note: Note };
    expect(updated.note.title).toBe("New");
    expect(updated.note.content).toBe("");
    expect(updated.note.updatedAt).not.toBe(note.updatedAt);
    expect(updated.note.createdAt).toBe(note.createdAt);
  });

  it("returns 404 when updating another user's note", async () => {
    const { token: alice } = await registerTestUser(rig, "alice");
    const { token: bob } = await registerTestUser(rig, "bob");
    const note = await createNote(rig, alice, { title: "Alice's" });
    const res = await rig.request(`/api/notes/${note.id}`, {
      method: "PUT",
      headers: authHeaders(bob),
      body: JSON.stringify({ title: "Hacked" }),
    });
    expect(res.status).toBe(404);
  });

  it("deletes a note and 404s on follow-up reads", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const note = await createNote(rig, token);
    const del = await rig.request(`/api/notes/${note.id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(del.status).toBe(204);
    const get = await rig.request(`/api/notes/${note.id}`, {
      headers: authHeaders(token),
    });
    expect(get.status).toBe(404);
  });

  it("rejects invalid create bodies with 422", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const res = await rig.request("/api/notes", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ title: "Just a title" }),
    });
    expect(res.status).toBe(422);
  });

  it("rejects oversized content with 422", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const res = await rig.request("/api/notes", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ...baseNote, content: "x".repeat(100_001) }),
    });
    expect(res.status).toBe(422);
  });

  it("accepts the data URLs the client actually produces", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const png = `data:image/png;base64,${"iVBORw0KGgo".repeat(4)}=`;
    const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const note = await createNote(rig, token, { images: [png, jpeg] });
    expect(note.images).toEqual([png, jpeg]);
  });

  it("rejects image values that are not inert image data URLs", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const cases: Array<[string, string]> = [
      ["javascript:alert(1)", "javascript scheme"],
      ["file:///etc/passwd", "file scheme"],
      ["https://example.com/cat.png", "remote url — images are inlined"],
      ["not a url", "not a url at all"],
      // A document format wearing an image content type. Excluded on purpose:
      // SVG can carry script into anything that renders an attachment by URL.
      ["data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "svg"],
      ["data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4=", "html masquerading"],
      ["data:image/png,notbase64", "missing base64 marker"],
      ["data:image/png;base64,not base64!", "outside the base64 alphabet"],
      // The anchors matter: without them a trailing fragment would ride along.
      [
        'data:image/png;base64,aGk="><script>alert(1)</script>',
        "smuggled suffix",
      ],
    ];
    for (const [url, why] of cases) {
      const res = await rig.request("/api/notes", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ ...baseNote, images: [url] }),
      });
      expect(res.status, `expected 422 for ${why}`).toBe(422);
    }
  });

  // The error messages quote MAX_IMAGE_SOURCE_BYTES, but the schema bounds the
  // encoded data URL. These pin the two together: an image of exactly the
  // advertised size must be accepted, in every media type, prefix length
  // included. Rounding the encoded cap by hand fails this by 18 bytes.
  it("accepts an image of exactly the advertised size", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const payload = Buffer.alloc(MAX_IMAGE_SOURCE_BYTES).toString("base64");
    for (const mime of ["png", "jpeg", "jpg", "gif", "webp", "avif"]) {
      const res = await rig.request("/api/notes", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          ...baseNote,
          images: [`data:image/${mime};base64,${payload}`],
        }),
      });
      expect(res.status, `expected 201 for a full-size image/${mime}`).toBe(
        201,
      );
    }
  });

  it("rejects an image past the advertised size", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const payload = Buffer.alloc(MAX_IMAGE_SOURCE_BYTES + 1024).toString(
      "base64",
    );
    const res = await rig.request("/api/notes", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        ...baseNote,
        images: [`data:image/png;base64,${payload}`],
      }),
    });
    expect(res.status).toBe(422);
  });

  it("rejects an image past the per-image cap with 422", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const prefix = "data:image/png;base64,";
    const oversized =
      prefix + "A".repeat(MAX_IMAGE_DATA_URL_BYTES - prefix.length + 1);
    const res = await rig.request("/api/notes", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ ...baseNote, images: [oversized] }),
    });
    expect(res.status).toBe(422);
  });

  it("rejects too many tags with 422", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const res = await rig.request("/api/notes", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        ...baseNote,
        tags: Array.from({ length: 51 }, (_, i) => `tag-${i}`),
      }),
    });
    expect(res.status).toBe(422);
  });

  it("stamps trashedAt from the server clock, ignoring the client's", async () => {
    const { token } = await registerTestUser(rig, "alice");
    // A client asking for a note that was trashed long enough ago to be
    // hard-deleted by the next cleanup sweep.
    const note = await createNote(rig, token, {
      trashed: true,
      trashedAt: "2001-01-01T00:00:00.000Z",
    });
    expect(note.trashedAt).not.toBe("2001-01-01T00:00:00.000Z");
    expect(Date.parse(note.trashedAt ?? "")).toBeGreaterThan(
      Date.now() - 60_000,
    );
  });

  it("leaves trashedAt null on a note that is not trashed", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const note = await createNote(rig, token, {
      trashedAt: "2001-01-01T00:00:00.000Z",
    });
    expect(note.trashedAt).toBeNull();
  });

  it("stamps on trash and clears on restore", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const note = await createNote(rig, token);

    const trashed = await putNote(rig, token, note.id, {
      trashed: true,
      trashedAt: "2001-01-01T00:00:00.000Z",
    });
    expect(Date.parse(trashed.trashedAt ?? "")).toBeGreaterThan(
      Date.now() - 60_000,
    );

    const restored = await putNote(rig, token, note.id, { trashed: false });
    expect(restored.trashedAt).toBeNull();
  });

  it("leaves an existing stamp alone when a change doesn't mention trashed", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const note = await createNote(rig, token);
    const trashed = await putNote(rig, token, note.id, { trashed: true });

    const edited = await putNote(rig, token, note.id, {
      title: "Renamed in the trash",
      trashedAt: "2001-01-01T00:00:00.000Z",
    });
    expect(edited.trashedAt).toBe(trashed.trashedAt);
  });

  it("PUT with matching If-Match succeeds", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const note = await createNote(rig, token, { title: "Old" });
    const res = await rig.request(`/api/notes/${note.id}`, {
      method: "PUT",
      headers: { ...authHeaders(token), "If-Match": note.updatedAt },
      body: JSON.stringify({ title: "New" }),
    });
    expect(res.status).toBe(200);
  });

  it("PUT with stale If-Match returns 412 and the current note", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const note = await createNote(rig, token, { title: "Original" });

    // Simulate a concurrent edit that bumps updatedAt.
    await rig.request(`/api/notes/${note.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ tags: ["concurrent"] }),
    });

    const res = await rig.request(`/api/notes/${note.id}`, {
      method: "PUT",
      headers: { ...authHeaders(token), "If-Match": note.updatedAt },
      body: JSON.stringify({ title: "Renamed" }),
    });
    expect(res.status).toBe(412);
    const body = (await res.json()) as { error: string; note: Note };
    expect(body.error).toMatch(/changed/i);
    expect(body.note.title).toBe("Original");
    expect(body.note.tags).toEqual(["concurrent"]);
  });

  describe("listing", () => {
    const PNG = `data:image/png;base64,${"iVBORw0KGgo".repeat(4)}=`;

    it("leaves attachments out of the list and sends the count instead", async () => {
      // The reason the endpoint is paged at all: an unpaged list of notes each
      // carrying its own pictures is a response with no upper bound.
      const { token } = await registerTestUser(rig, "alice");
      await createNote(rig, token, { title: "Holiday", images: [PNG] });

      const res = await rig.request("/api/notes", {
        headers: authHeaders(token),
      });
      const body = (await res.json()) as NotesResponse;
      expect(body.notes[0].images).toEqual([]);
      expect(body.notes[0].imageCount).toBe(1);

      // Reading the one note is what fetches the bytes.
      const one = await rig.request(`/api/notes/${body.notes[0].id}`, {
        headers: authHeaders(token),
      });
      expect(((await one.json()) as { note: Note }).note.images).toEqual([PNG]);
    });

    it("pages, and the cursor reaches the rest", async () => {
      const { token } = await registerTestUser(rig, "alice");
      for (let i = 0; i < 3; i++) {
        await createNote(rig, token, { title: `Note ${i}` });
      }

      const first = await rig.request("/api/notes?limit=2", {
        headers: authHeaders(token),
      });
      const firstPage = (await first.json()) as NotesResponse;
      expect(firstPage.notes).toHaveLength(2);
      expect(firstPage.nextCursor).toBeTruthy();

      const second = await rig.request(
        `/api/notes?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor as string)}`,
        { headers: authHeaders(token) },
      );
      const secondPage = (await second.json()) as NotesResponse;
      expect(secondPage.notes).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();
    });

    it("clamps a limit rather than refusing it", async () => {
      // A caller asking for more than a page holds wants as much as it can
      // get; a 400 tells it nothing it can act on.
      const { token } = await registerTestUser(rig, "alice");
      await createNote(rig, token, { title: "One" });

      for (const query of ["?limit=0", "?limit=99999", "?limit=nonsense"]) {
        const res = await rig.request(`/api/notes${query}`, {
          headers: authHeaders(token),
        });
        expect(res.status, query).toBe(200);
        expect(((await res.json()) as NotesResponse).notes).toHaveLength(1);
      }
    });

    it("refuses a cursor it did not write", async () => {
      // Quietly restarting from the top would hand a paging client the first
      // page over and over, and look like a server with two notes on it.
      const { token } = await registerTestUser(rig, "alice");
      const res = await rig.request("/api/notes?cursor=not-a-cursor", {
        headers: authHeaders(token),
      });
      expect(res.status).toBe(400);
    });
  });
});
