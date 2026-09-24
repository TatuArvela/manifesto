import type { Note, NoteCreate, NotesResponse } from "@manifesto/shared";
import {
  attachmentIdOf,
  MAX_NOTES_PER_IMPORT,
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

  it("refuses an image that is not an attachment reference", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const cases: Array<[string, string]> = [
      // Bytes never ride in a note; they are uploaded first.
      [`data:image/png;base64,${"iVBORw0KGgo".repeat(4)}=`, "an inline image"],
      ["javascript:alert(1)", "javascript scheme"],
      ["file:///etc/passwd", "file scheme"],
      ["https://example.com/cat.png", "remote url"],
      ["not a url", "not a url at all"],
      ["attachment:../../etc/passwd", "a reference that is not a ULID"],
      ["local:0123abcd", "an open-mode reference"],
    ];
    for (const [image, why] of cases) {
      const res = await rig.request("/api/notes", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ ...baseNote, images: [image] }),
      });
      expect(res.status, `expected 422 for ${why}`).toBe(422);
    }
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

  describe("import", () => {
    async function importNotes(token: string, notes: unknown[]) {
      const res = await rig.request("/api/notes/import", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ notes }),
      });
      expect(res.status).toBe(200);
      return await res.json();
    }

    async function listIds(token: string): Promise<string[]> {
      const res = await rig.request("/api/notes", {
        headers: authHeaders(token),
      });
      return ((await res.json()) as NotesResponse).notes.map((n) => n.id);
    }

    it("keeps the id and creation time, and updates on a second import", async () => {
      const { token } = await registerTestUser(rig, "alice");
      const backup = {
        ...baseNote,
        id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
        createdAt: "2020-01-02T03:04:05.000Z",
        title: "From a backup",
      };

      expect(await importNotes(token, [backup])).toEqual({
        created: 1,
        updated: 0,
        skipped: 0,
      });
      expect(await importNotes(token, [{ ...backup, title: "Again" }])).toEqual(
        { created: 0, updated: 1, skipped: 0 },
      );

      expect(await listIds(token)).toEqual([backup.id]);
      const res = await rig.request(`/api/notes/${backup.id}`, {
        headers: authHeaders(token),
      });
      const { note } = (await res.json()) as { note: Note };
      expect(note.title).toBe("Again");
      expect(note.createdAt).toBe(backup.createdAt);
    });

    it("gives a new id when the id is someone else's note", async () => {
      const alice = await registerTestUser(rig, "alice");
      const bob = await registerTestUser(rig, "bob");
      const theirs = await createNote(rig, alice.token, { title: "Alice's" });

      expect(
        await importNotes(bob.token, [{ ...baseNote, id: theirs.id }]),
      ).toEqual({ created: 1, updated: 0, skipped: 0 });

      const bobs = await listIds(bob.token);
      expect(bobs).toHaveLength(1);
      expect(bobs[0]).not.toBe(theirs.id);
      expect(await listIds(alice.token)).toEqual([theirs.id]);
    });

    it("refuses more notes than one request may carry", async () => {
      const { token } = await registerTestUser(rig, "alice");
      const res = await rig.request("/api/notes/import", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          notes: Array.from(
            { length: MAX_NOTES_PER_IMPORT + 1 },
            () => baseNote,
          ),
        }),
      });
      expect(res.status).toBe(422);
    });
  });

  it("deletes every note of the user's and only theirs", async () => {
    const alice = await registerTestUser(rig, "alice");
    const bob = await registerTestUser(rig, "bob");
    await createNote(rig, alice.token);
    await createNote(rig, alice.token);
    const kept = await createNote(rig, bob.token);

    const res = await rig.request("/api/notes", {
      method: "DELETE",
      headers: authHeaders(alice.token),
    });
    expect(res.status).toBe(204);

    const listed = async (token: string) =>
      (
        (await (
          await rig.request("/api/notes", { headers: authHeaders(token) })
        ).json()) as NotesResponse
      ).notes.map((n) => n.id);
    expect(await listed(alice.token)).toEqual([]);
    expect(await listed(bob.token)).toEqual([kept.id]);
  });

  describe("listing", () => {
    const PNG = `data:image/png;base64,${"iVBORw0KGgo".repeat(4)}=`;

    it("leaves attachments out of the list and sends the count instead", async () => {
      // The reason the endpoint is paged at all: an unpaged list of notes each
      // carrying its own pictures is a response with no upper bound.
      const { token } = await registerTestUser(rig, "alice");
      const uploaded = await rig.request("/api/attachments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "image/png",
        },
        body: Buffer.from(PNG.slice(PNG.indexOf(",") + 1), "base64"),
      });
      const { ref: uploadedRef } = (await uploaded.json()) as { ref: string };
      await createNote(rig, token, { title: "Holiday", images: [uploadedRef] });

      const res = await rig.request("/api/notes", {
        headers: authHeaders(token),
      });
      const body = (await res.json()) as NotesResponse;
      expect(body.notes[0].images).toEqual([]);
      expect(body.notes[0].imageCount).toBe(1);

      // Reading the one note gives the reference, and that the bytes.
      const one = await rig.request(`/api/notes/${body.notes[0].id}`, {
        headers: authHeaders(token),
      });
      const [ref] = ((await one.json()) as { note: Note }).note.images;
      const bytes = await rig.request(
        `/api/attachments/${attachmentIdOf(ref)}`,
        { headers: authHeaders(token) },
      );
      expect(bytes.headers.get("Content-Type")).toBe("image/png");
      expect(Buffer.from(await bytes.arrayBuffer())).toEqual(
        Buffer.from(PNG.slice(PNG.indexOf(",") + 1), "base64"),
      );
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
