import type {
  ApiTokenCreatedResponse,
  Note,
  NoteCreate,
  NoteVersionsResponse,
  SealedNote,
} from "@manifesto/shared";
import {
  MAX_NOTE_VERSIONS,
  NoteColor,
  NoteFont,
  noteSealKey,
  resealSharedFields,
  sealPreviousKeys,
  unwrapNoteKey,
  wrapNoteKey,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ciphertext } from "#/storage/contracts/claimed.ts";
import { defined } from "#/test/defined.ts";
import { testAccountKeys } from "#/test/keyedTokens.ts";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "#/test/setup.ts";
import { versionTimestamp } from "./versions.ts";

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
        await call(who, "GET", `/api/v1/notes/${note.id}/versions`)
      ).json()) as NoteVersionsResponse
    ).versions;

  beforeEach(async () => {
    rig = await bootTestApp();
    owner = await registerTestUser(rig, "olivia");
    viewer = await registerTestUser(rig, "victor");
    stranger = await registerTestUser(rig, "sam");
    const res = await call(owner, "POST", "/api/v1/notes", baseNote);
    note = ((await res.json()) as { note: Note }).note;
    await call(owner, "POST", `/api/v1/notes/${note.id}/shares`, {
      userId: viewer.userId,
      role: "view",
    });
    await call(viewer, "POST", `/api/v1/invitations/${note.id}/accept`);
  });

  afterEach(async () => {
    await rig.close();
  });

  it("keeps a history everyone holding the note reads, newest first", async () => {
    for (const content of ["v1", "v2"]) {
      const res = await call(
        owner,
        "POST",
        `/api/v1/notes/${note.id}/versions`,
        {
          title: "Plan",
          content,
        },
      );
      expect(res.status).toBe(201);
    }
    expect((await versions(owner)).map((v) => v.content)).toEqual(["v2", "v1"]);
    expect((await versions(viewer)).map((v) => v.content)).toEqual([
      "v2",
      "v1",
    ]);
  });

  it("lets only those who can edit add to it", async () => {
    const res = await call(
      viewer,
      "POST",
      `/api/v1/notes/${note.id}/versions`,
      {
        title: "",
        content: "sneaky",
      },
    );
    expect(res.status).toBe(403);
    const unknown = await call(
      stranger,
      "POST",
      `/api/v1/notes/${note.id}/versions`,
      { title: "", content: "x" },
    );
    expect(unknown.status).toBe(404);
    expect(
      (await call(stranger, "GET", `/api/v1/notes/${note.id}/versions`)).status,
    ).toBe(404);
  });

  it("opens for a token what was written before the note's key was replaced", async () => {
    const minted = await call(owner, "POST", "/api/v1/tokens", {
      password: "test-pass-12",
      name: "script",
    });
    const script = {
      ...owner,
      token: defined(((await minted.json()) as ApiTokenCreatedResponse).secret),
    };
    // Written by the token, so under keys the server really opens with.
    const made = await call(script, "POST", "/api/v1/notes", baseNote);
    const id = ((await made.json()) as { note: Note }).note.id;
    const add = (content: string) =>
      call(script, "POST", `/api/v1/notes/${id}/versions`, {
        title: "",
        content,
      });
    expect((await add("before")).status).toBe(201);

    // The owner's app replaces the key, as `Sealer.rekey` does.
    const read = await rig.rawRequest(`/api/v1/notes/${id}`, {
      headers: authHeaders(owner.token),
    });
    const sealed = ((await read.json()) as { note: SealedNote }).note;
    const account = await testAccountKeys(owner.userId);
    const oldRaw = await unwrapNoteKey(
      account,
      id,
      sealed.keyVersion,
      sealed.key,
    );
    if (!oldRaw) throw new Error("The test keys do not open the note");
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await noteSealKey(raw, 2);
    const fields = await resealSharedFields(
      await noteSealKey(oldRaw, 1),
      key,
      id,
      sealed,
    );
    expect(fields).not.toBeNull();
    const rekeyed = await rig.rawRequest(`/api/v1/notes/${id}/key`, {
      method: "PUT",
      headers: { ...authHeaders(owner.token), "If-Match": sealed.updatedAt },
      body: JSON.stringify({
        keyVersion: 2,
        key: await wrapNoteKey(account, id, 2, raw),
        previousKeys: await sealPreviousKeys(key, id, new Map([[1, oldRaw]])),
        ...fields,
      }),
    });
    expect(rekeyed.status).toBe(200);
    expect((await add("after")).status).toBe(201);

    const res = await call(script, "GET", `/api/v1/notes/${id}/versions`);
    const history = ((await res.json()) as NoteVersionsResponse).versions;
    expect(history.map((v) => v.content)).toEqual(["after", "before"]);
  });

  it("keeps a brought-across version's own date", async () => {
    const then = new Date(Date.now() - 86_400_000).toISOString();
    await call(owner, "POST", `/api/v1/notes/${note.id}/versions`, {
      title: "",
      content: "old",
      timestamp: then,
    });
    expect((await versions(owner))[0]?.timestamp).toBe(then);
  });

  it("keeps the newest versions only", async () => {
    for (let i = 0; i < MAX_NOTE_VERSIONS + 3; i++) {
      await rig.storage.versions.add({
        id: `v${String(i).padStart(3, "0")}`,
        noteId: note.id,
        authorId: owner.userId,
        keyVersion: 1,
        format: 1,
        title: ciphertext(""),
        content: ciphertext(String(i)),
        createdAt: new Date(Date.now() - (100 - i) * 1000).toISOString(),
      });
    }
    const kept = await versions(owner);
    expect(kept).toHaveLength(MAX_NOTE_VERSIONS);
    expect(kept[0]?.content).toBe(String(MAX_NOTE_VERSIONS + 2));
  });

  it("goes with the note", async () => {
    await call(owner, "POST", `/api/v1/notes/${note.id}/versions`, {
      title: "",
      content: "x",
    });
    await call(owner, "DELETE", `/api/v1/notes/${note.id}`);
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
