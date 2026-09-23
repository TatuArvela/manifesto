import type { Note, NoteCreate, NoteVersionsResponse } from "@manifesto/shared";
import { MAX_NOTE_VERSIONS, NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";
import { versionTimestamp } from "./versions.js";

const baseNote: NoteCreate = {
  title: "Plan",
  content: "v1",
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

interface Account {
  token: string;
  userId: string;
}

describe("version routes", () => {
  let rig: TestRig;
  let owner: Account;
  let viewer: Account;
  let stranger: Account;
  let note: Note;

  const call = (who: Account, method: string, path: string, body?: unknown) =>
    rig.request(path, {
      method,
      headers: authHeaders(who.token),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  const versions = async (who: Account) =>
    (
      (await (
        await call(who, "GET", `/api/notes/${note.id}/versions`)
      ).json()) as NoteVersionsResponse
    ).versions;

  beforeEach(async () => {
    rig = await bootTestApp();
    owner = await registerTestUser(rig, "olivia");
    viewer = await registerTestUser(rig, "victor");
    stranger = await registerTestUser(rig, "sam");
    const res = await call(owner, "POST", "/api/notes", baseNote);
    note = ((await res.json()) as { note: Note }).note;
    await call(owner, "POST", `/api/notes/${note.id}/shares`, {
      userId: viewer.userId,
      role: "view",
    });
    await call(viewer, "POST", `/api/invitations/${note.id}/accept`);
  });

  afterEach(async () => {
    await rig.close();
  });

  it("keeps a history everyone holding the note reads, newest first", async () => {
    for (const content of ["v1", "v2"]) {
      const res = await call(owner, "POST", `/api/notes/${note.id}/versions`, {
        title: "Plan",
        content,
      });
      expect(res.status).toBe(201);
    }
    expect((await versions(owner)).map((v) => v.content)).toEqual(["v2", "v1"]);
    expect((await versions(viewer)).map((v) => v.content)).toEqual([
      "v2",
      "v1",
    ]);
  });

  it("lets only those who can edit add to it", async () => {
    const res = await call(viewer, "POST", `/api/notes/${note.id}/versions`, {
      title: "",
      content: "sneaky",
    });
    expect(res.status).toBe(403);
    const unknown = await call(
      stranger,
      "POST",
      `/api/notes/${note.id}/versions`,
      { title: "", content: "x" },
    );
    expect(unknown.status).toBe(404);
    expect(
      (await call(stranger, "GET", `/api/notes/${note.id}/versions`)).status,
    ).toBe(404);
  });

  it("keeps a brought-across version's own date", async () => {
    const then = new Date(Date.now() - 86_400_000).toISOString();
    await call(owner, "POST", `/api/notes/${note.id}/versions`, {
      title: "",
      content: "old",
      timestamp: then,
    });
    expect((await versions(owner))[0].timestamp).toBe(then);
  });

  it("keeps the newest versions only", async () => {
    for (let i = 0; i < MAX_NOTE_VERSIONS + 3; i++) {
      await rig.storage.versions.add({
        id: `v${String(i).padStart(3, "0")}`,
        noteId: note.id,
        authorId: owner.userId,
        title: "",
        content: String(i),
        createdAt: new Date(Date.now() - (100 - i) * 1000).toISOString(),
      });
    }
    const kept = await versions(owner);
    expect(kept).toHaveLength(MAX_NOTE_VERSIONS);
    expect(kept[0].content).toBe(String(MAX_NOTE_VERSIONS + 2));
  });

  it("goes with the note", async () => {
    await call(owner, "POST", `/api/notes/${note.id}/versions`, {
      title: "",
      content: "x",
    });
    await call(owner, "DELETE", `/api/notes/${note.id}`);
    expect(await rig.storage.versions.list(note.id)).toEqual([]);
  });
});

describe("versionTimestamp", () => {
  const now = "2026-04-01T00:00:00.000Z";
  it("keeps a real past moment and refuses the rest", () => {
    expect(versionTimestamp("2026-03-31T00:00:00Z", now)).toBe(
      "2026-03-31T00:00:00.000Z",
    );
    expect(versionTimestamp(undefined, now)).toBe(now);
    expect(versionTimestamp("soon", now)).toBe(now);
    expect(versionTimestamp("2027-01-01T00:00:00Z", now)).toBe(now);
    expect(versionTimestamp("2020-01-01T00:00:00Z", now)).toBe(now);
  });
});
