import type { Note, NoteCreate } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authHeaders, bootTestApp, type TestRig } from "./test/setup.js";

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

describe("end-to-end smoke", () => {
  let rig: TestRig;

  beforeEach(() => {
    rig = bootTestApp();
  });

  afterEach(() => {
    rig.db.close();
  });

  it("walks the full register -> CRUD -> search -> logout cycle", async () => {
    const reg = await rig.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "password-1234" }),
    });
    expect(reg.status).toBe(201);
    const { token } = (await reg.json()) as { token: string };

    const empty = await rig.request("/api/notes", {
      headers: authHeaders(token),
    });
    expect(((await empty.json()) as { notes: Note[] }).notes).toEqual([]);

    const create = await rig.request("/api/notes", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        ...baseNote,
        title: "Hello",
        content: "World",
        color: NoteColor.Yellow,
      }),
    });
    expect(create.status).toBe(201);
    const note = ((await create.json()) as { note: Note }).note;

    const list = await rig.request("/api/notes", {
      headers: authHeaders(token),
    });
    expect(
      ((await list.json()) as { notes: Note[] }).notes.map((n) => n.id),
    ).toEqual([note.id]);

    const update = await rig.request(`/api/notes/${note.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ title: "Renamed" }),
    });
    expect(update.status).toBe(200);

    const search = await rig.request("/api/search?q=renamed", {
      headers: authHeaders(token),
    });
    const found = ((await search.json()) as { notes: Note[] }).notes;
    expect(found.map((n) => n.id)).toEqual([note.id]);

    const del = await rig.request(`/api/notes/${note.id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(del.status).toBe(204);

    const out = await rig.request("/api/auth/logout", {
      method: "POST",
      headers: authHeaders(token),
    });
    expect(out.status).toBe(204);

    const after = await rig.request("/api/notes", {
      headers: authHeaders(token),
    });
    expect(after.status).toBe(401);
  });
});
