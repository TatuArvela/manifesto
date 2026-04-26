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

async function seedNote(
  rig: TestRig,
  token: string,
  fields: Partial<NoteCreate>,
): Promise<Note> {
  const res = await rig.request("/api/notes", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ ...baseNote, ...fields }),
  });
  return ((await res.json()) as { note: Note }).note;
}

describe("search route", () => {
  let rig: TestRig;

  beforeEach(async () => {
    rig = await bootTestApp();
  });

  afterEach(async () => {
    await rig.close();
  });

  it("returns notes matching a substring on title or content", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const a = await seedNote(rig, token, {
      title: "Shopping list",
      content: "Eggs and milk",
    });
    const b = await seedNote(rig, token, {
      title: "Trip notes",
      content: "Fly to LAX",
    });
    await seedNote(rig, token, { title: "Untitled", content: "" });

    const res1 = await rig.request("/api/search?q=eggs", {
      headers: authHeaders(token),
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { notes: Note[] };
    expect(body1.notes.map((n) => n.id)).toEqual([a.id]);

    const res2 = await rig.request("/api/search?q=TRIP", {
      headers: authHeaders(token),
    });
    expect(
      ((await res2.json()) as { notes: Note[] }).notes.map((n) => n.id),
    ).toEqual([b.id]);
  });

  it("returns an empty list for a blank query", async () => {
    const { token } = await registerTestUser(rig, "alice");
    await seedNote(rig, token, { title: "x", content: "y" });
    const res = await rig.request("/api/search?q=", {
      headers: authHeaders(token),
    });
    expect(((await res.json()) as { notes: Note[] }).notes).toEqual([]);
  });

  it("URL-decodes query parameters", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const note = await seedNote(rig, token, {
      title: "hello world & stuff",
      content: "",
    });
    const encoded = encodeURIComponent("world & stuff");
    const res = await rig.request(`/api/search?q=${encoded}`, {
      headers: authHeaders(token),
    });
    expect(
      ((await res.json()) as { notes: Note[] }).notes.map((n) => n.id),
    ).toEqual([note.id]);
  });

  it("scopes search to the authenticated user", async () => {
    const { token: alice } = await registerTestUser(rig, "alice");
    const { token: bob } = await registerTestUser(rig, "bob");
    await seedNote(rig, alice, { title: "Secret stuff", content: "" });
    const res = await rig.request("/api/search?q=secret", {
      headers: authHeaders(bob),
    });
    expect(((await res.json()) as { notes: Note[] }).notes).toEqual([]);
  });
});
