import type { Note, NoteCreate, SyncResponse } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nowIso } from "../lib/time.js";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";
import { decodeCheckpoint, encodeCheckpoint, SYNC_OVERLAP_MS } from "./sync.js";

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

type Account = { token: string; userId: string };

/** Far enough past the overlap that a checkpoint no longer re-reads it. */
const LATER = SYNC_OVERLAP_MS + 60_000;

describe("sync route", () => {
  let rig: TestRig;
  let owner: Account;
  let alice: Account;

  beforeEach(async () => {
    // Past every stamp an earlier test left: `nowIso` never goes backwards.
    vi.useFakeTimers({
      toFake: ["Date"],
      now: Date.parse(nowIso()) + 3_600_000,
    });
    rig = await bootTestApp();
    owner = await registerTestUser(rig, "olivia");
    alice = await registerTestUser(rig, "alice");
  });

  afterEach(async () => {
    await rig.close();
    vi.useRealTimers();
  });

  const later = () => vi.setSystemTime(Date.now() + LATER);

  function call(
    who: Account,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    return rig.request(path, {
      method,
      headers: authHeaders(who.token),
      body: body === undefined ? null : JSON.stringify(body),
    });
  }

  async function create(title: string, who = owner): Promise<Note> {
    const res = await call(who, "POST", "/api/notes", { ...baseNote, title });
    expect(res.status).toBe(201);
    return ((await res.json()) as { note: Note }).note;
  }

  async function page(
    who: Account,
    query: Record<string, string>,
  ): Promise<SyncResponse> {
    const res = await call(
      who,
      "GET",
      `/api/sync?${new URLSearchParams(query)}`,
    );
    expect(res.status).toBe(200);
    return (await res.json()) as SyncResponse;
  }

  /** Every page of one sync, as a client drains it. */
  async function sync(who: Account, since?: string) {
    const notes: Note[] = [];
    let cursor: string | null = null;
    for (;;) {
      const body: SyncResponse = await page(who, {
        ...(since !== undefined && { since }),
        ...(cursor !== null && { cursor }),
      });
      notes.push(...body.notes);
      if (body.nextCursor === null) {
        return {
          titles: notes.map((n) => n.title).sort(),
          notes,
          ids: body.ids ?? [],
          checkpoint: body.checkpoint as string,
        };
      }
      cursor = body.nextCursor;
    }
  }

  it("gives everything without a checkpoint, and only changes with one", async () => {
    const kept = await create("kept");
    const edited = await create("edited");
    later();
    const first = await sync(owner);
    expect(first.titles).toEqual(["edited", "kept"]);
    expect(first.ids.sort()).toEqual([edited.id, kept.id].sort());

    later();
    await call(owner, "PUT", `/api/notes/${edited.id}`, { title: "edited!" });
    await create("new");

    const second = await sync(owner, first.checkpoint);
    expect(second.titles).toEqual(["edited!", "new"]);
    expect(second.ids).toHaveLength(3);
    expect(second.notes.every((n) => n.images.length === 0)).toBe(true);
  });

  it("reads the overlap again, so a write stamped before the checkpoint is not lost", async () => {
    // Stamped a moment before the sync, as a slow request's write would be
    // if it committed after the sync had read.
    await create("slow");
    vi.setSystemTime(Date.now() + SYNC_OVERLAP_MS - 1000);
    const { checkpoint } = await sync(owner);
    expect((await sync(owner, checkpoint)).titles).toEqual(["slow"]);
  });

  it("leaves a deleted note out of the ids", async () => {
    const gone = await create("gone");
    const stays = await create("stays");
    later();
    const { checkpoint } = await sync(owner);

    later();
    expect((await call(owner, "DELETE", `/api/notes/${gone.id}`)).status).toBe(
      204,
    );
    const next = await sync(owner, checkpoint);
    expect(next.notes).toEqual([]);
    expect(next.ids).toEqual([stays.id]);
  });

  it("fixes the checkpoint at the first page, and hands it out on the last", async () => {
    for (const title of ["a", "b", "c"]) await create(title);

    const first = await page(owner, { limit: "2" });
    expect(first.checkpoint).toBeNull();
    expect(first.ids).toBeNull();
    later();
    const last = await page(owner, {
      limit: "2",
      cursor: first.nextCursor as string,
    });
    expect(last.nextCursor).toBeNull();
    expect(last.ids).toHaveLength(3);
    expect(decodeCheckpoint(last.checkpoint as string)).toBe(
      new Date(Date.now() - LATER - SYNC_OVERLAP_MS).toISOString(),
    );
    expect([...first.notes, ...last.notes].map((n) => n.title).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  describe("shared notes", () => {
    async function invite(noteId: string, role = "edit") {
      const res = await call(owner, "POST", `/api/notes/${noteId}/shares`, {
        userId: alice.userId,
        role,
      });
      expect(res.status).toBe(201);
    }

    it("brings an old note to a recipient who accepts it", async () => {
      const note = await create("old");
      await invite(note.id);
      const { checkpoint } = await sync(alice);

      later();
      await call(alice, "POST", `/api/invitations/${note.id}/accept`);
      const next = await sync(alice, checkpoint);
      expect(next.titles).toEqual(["old"]);
      expect(next.ids).toEqual([note.id]);
    });

    it("tells everyone on a note when its members change", async () => {
      const note = await create("shared");
      await invite(note.id);
      await call(alice, "POST", `/api/invitations/${note.id}/accept`);
      const ownerCheckpoint = (await sync(owner)).checkpoint;
      const aliceCheckpoint = (await sync(alice)).checkpoint;

      later();
      await call(owner, "PUT", `/api/notes/${note.id}/shares/${alice.userId}`, {
        role: "view",
      });
      const alicesView = await sync(alice, aliceCheckpoint);
      expect(alicesView.notes[0]?.sharing?.role).toBe("view");
      // The note's concurrency token is left alone.
      expect(alicesView.notes[0]?.updatedAt).toBe(note.updatedAt);

      const ownerCheckpoint2 = (await sync(owner, ownerCheckpoint)).checkpoint;
      later();
      await call(
        owner,
        "DELETE",
        `/api/notes/${note.id}/shares/${alice.userId}`,
      );
      const ownersView = await sync(owner, ownerCheckpoint2);
      expect(ownersView.titles).toEqual(["shared"]);
      expect(ownersView.notes[0]?.sharing ?? null).toBeNull();
      expect((await sync(alice, aliceCheckpoint)).ids).toEqual([]);
    });

    it("takes a note the owner trashes away from its recipients", async () => {
      const note = await create("shared");
      await invite(note.id);
      await call(alice, "POST", `/api/invitations/${note.id}/accept`);
      const { checkpoint } = await sync(alice);

      later();
      await call(owner, "PUT", `/api/notes/${note.id}`, { trashed: true });
      const next = await sync(alice, checkpoint);
      expect(next.notes).toEqual([]);
      expect(next.ids).toEqual([]);
    });
  });

  it("refuses a checkpoint or cursor it did not write", async () => {
    for (const query of [
      "since=nonsense",
      `since=${Buffer.from("2026-01-01").toString("base64url")}`,
      "cursor=nonsense",
    ]) {
      expect((await call(owner, "GET", `/api/sync?${query}`)).status).toBe(400);
    }
  });
});

describe("checkpoints", () => {
  it("round-trip a time and refuse anything else", () => {
    const iso = "2026-01-01T00:00:00.000Z";
    expect(decodeCheckpoint(encodeCheckpoint(iso))).toBe(iso);
    expect(decodeCheckpoint(encodeCheckpoint("2026-01-01"))).toBeNull();
    expect(decodeCheckpoint(encodeCheckpoint("yesterday"))).toBeNull();
    expect(decodeCheckpoint("")).toBeNull();
  });
});
