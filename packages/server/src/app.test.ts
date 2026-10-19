import type { Note, NoteCreate } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authHeaders, bootTestApp, type TestRig } from "./test/setup.ts";

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

  beforeEach(async () => {
    rig = await bootTestApp();
  });

  afterEach(async () => {
    await rig.close();
  });

  it("walks the full register -> CRUD -> search -> logout cycle", async () => {
    const reg = await rig.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "password-1234" }),
    });
    expect(reg.status).toBe(201);
    const { token } = (await reg.json()) as { token: string };

    const empty = await rig.request("/api/v1/notes", {
      headers: authHeaders(token),
    });
    expect(((await empty.json()) as { notes: Note[] }).notes).toEqual([]);

    const create = await rig.request("/api/v1/notes", {
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

    const list = await rig.request("/api/v1/notes", {
      headers: authHeaders(token),
    });
    expect(
      ((await list.json()) as { notes: Note[] }).notes.map((n) => n.id),
    ).toEqual([note.id]);

    const update = await rig.request(`/api/v1/notes/${note.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ title: "Renamed" }),
    });
    expect(update.status).toBe(200);

    // The app searches the notes it has opened; the server cannot.
    const search = await rig.request("/api/v1/search?q=renamed", {
      headers: authHeaders(token),
    });
    expect(search.status).toBe(403);

    const del = await rig.request(`/api/v1/notes/${note.id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(del.status).toBe(204);

    const out = await rig.request("/api/v1/auth/logout", {
      method: "POST",
      headers: authHeaders(token),
    });
    expect(out.status).toBe(204);

    const after = await rig.request("/api/v1/notes", {
      headers: authHeaders(token),
    });
    expect(after.status).toBe(401);
  });
});

describe("addresses from before the API was versioned", () => {
  let rig: TestRig;

  beforeEach(async () => {
    rig = await bootTestApp();
  });

  afterEach(async () => {
    await rig.close();
  });

  it("sends a calendar feed on to its place, keeping the query", async () => {
    const res = await rig.rawRequest("/api/calendar/mfc_secret.ics?x=1");
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe(
      "/api/v1/calendar/mfc_secret.ics?x=1",
    );
  });

  it("sends an assistant's MCP request on with its method and body", async () => {
    const res = await rig.rawRequest("/api/mcp", {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("/api/v1/mcp");
  });

  it("answers nothing else under the old path", async () => {
    for (const path of ["/api/health", "/api/notes", "/api/openapi.json"]) {
      expect((await rig.rawRequest(path)).status, path).toBe(404);
    }
    expect((await rig.rawRequest("/api/v1/health")).status).toBe(200);
  });
});
