import type { Note, NoteCreate } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
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

describe("notes routes", () => {
  let rig: TestRig;

  beforeEach(() => {
    rig = bootTestApp();
  });

  afterEach(() => {
    rig.db.close();
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
    expect(await res.json()).toEqual({ notes: [] });
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
    expect(await list.json()).toEqual({ notes: [] });
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
});
