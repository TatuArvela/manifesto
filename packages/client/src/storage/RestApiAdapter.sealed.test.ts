import {
  type Note,
  NoteColor,
  type NoteCreate,
  NoteFont,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../test/defined.js";
import { SealedServer, testKeys } from "../test/sealedServer.js";
import { NoteConflictError, RestApiAdapter } from "./RestApiAdapter.js";
import { LockedError, Sealer, type StorageKeys } from "./sealing.js";

/**
 * The adapter against a server that holds only what it is sent: every word of
 * a note has to leave sealed and come back readable, and nothing readable may
 * be left on the server.
 */

const draft: NoteCreate = {
  title: "Groceries",
  content: "Milk and eggs, then the dentist at three.",
  color: NoteColor.Yellow,
  font: NoteFont.Serif,
  pinned: true,
  archived: false,
  trashed: false,
  trashedAt: null,
  position: 3,
  tags: ["home", "errands"],
  images: [],
  linkPreviews: [
    { url: "https://example.com/a", title: "Example", domain: "example.com" },
  ],
  reminder: null,
};

/** Words that must never reach the server readable. */
const WORDS = ["Groceries", "Milk", "dentist", "errands", "yellow", "serif"];

describe("RestApiAdapter with sealing", () => {
  let server: SealedServer;
  let keys: StorageKeys;
  let adapter: RestApiAdapter;

  const adapterFor = (with_: StorageKeys | null) =>
    new RestApiAdapter("http://server.test", "tok", {
      sealer: with_ ? new Sealer(with_) : null,
    });

  beforeEach(async () => {
    server = new SealedServer();
    vi.stubGlobal("fetch", server.fetch);
    keys = await testKeys();
    adapter = adapterFor(keys);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a note the server cannot read, and reads it back", async () => {
    const created = await adapter.create(draft);
    expect(created).toMatchObject({ ...draft, id: expect.any(String) });

    const held = defined(server.notes.get(created.id));
    expect(held.pinned).toBe(true);
    expect(held.position).toBe(3);
    const dump = server.dump();
    for (const word of WORDS) expect(dump, word).not.toContain(word);
    // The first words of the text are kept sealed beside it.
    expect(held.excerpt.startsWith("e1.")).toBe(true);

    expect(await adapter.get(created.id)).toEqual(created);
    expect(await adapter.getAll()).toEqual([created]);
  });

  it("opens the note on another device of the same account, and on no other account", async () => {
    const created = await adapter.create(draft);

    const otherDevice = adapterFor(keys);
    expect(await otherDevice.get(created.id)).toEqual(created);

    const stranger = adapterFor(await testKeys("u2"));
    expect(await stranger.get(created.id)).toBeNull();
    expect(await stranger.getAll()).toEqual([]);
  });

  it("does not open a note's values moved onto another note", async () => {
    const a = await adapter.create(draft);
    const b = await adapter.create({ ...draft, title: "Other" });
    const heldA = defined(server.notes.get(a.id));
    const heldB = defined(server.notes.get(b.id));
    // A server that swaps a title between two notes of one account.
    server.notes.set(b.id, { ...heldB, title: heldA.title });
    const read = await adapterFor(keys).get(b.id);
    expect(read?.title).toBe("");
    expect(read?.content).toBe(draft.content);
  });

  it("seals only what an update changes, with the excerpt beside the text", async () => {
    const created = await adapter.create(draft);
    const before = defined(server.notes.get(created.id));

    const updated = await adapter.update(created.id, {
      content: "Changed text",
      pinned: false,
    });
    expect(updated).toMatchObject({
      title: "Groceries",
      content: "Changed text",
      pinned: false,
      tags: ["home", "errands"],
    });
    const after = defined(server.notes.get(created.id));
    expect(after.title).toBe(before.title);
    expect(after.tags).toBe(before.tags);
    expect(after.content).not.toBe(before.content);
    expect(after.excerpt).not.toBe(before.excerpt);
    expect(server.dump()).not.toContain("Changed text");
  });

  it("updates a note this device has not opened yet, by reading its key first", async () => {
    const created = await adapter.create(draft);
    const fresh = adapterFor(keys);
    const updated = await fresh.update(created.id, { title: "Renamed" });
    expect(updated.title).toBe("Renamed");
    expect((await adapter.get(created.id))?.title).toBe("Renamed");
  });

  it("hands a conflict's note back opened", async () => {
    const created = await adapter.create(draft);
    await adapter.update(created.id, { title: "Theirs" });
    const stale = adapter.update(
      created.id,
      { title: "Mine" },
      { ifMatch: created.updatedAt },
    );
    await expect(stale).rejects.toBeInstanceOf(NoteConflictError);
    await stale.catch((err: NoteConflictError) => {
      expect(err.currentNote.title).toBe("Theirs");
    });
  });

  it("refuses a value past what a note may hold, before anything is sent", async () => {
    const sent = server.requests.length;
    await expect(
      adapter.create({ ...draft, title: "x".repeat(501) }),
    ).rejects.toThrow();
    await expect(
      adapter.create({
        ...draft,
        tags: Array.from({ length: 51 }, (_, i) => `t${i}`),
      }),
    ).rejects.toThrow();
    expect(server.requests.length).toBe(sent);
  });

  it("neither reads nor writes while the account is locked", async () => {
    const created = await adapter.create(draft);
    const locked = adapterFor(null);
    await expect(locked.getAll()).rejects.toBeInstanceOf(LockedError);
    await expect(locked.get(created.id)).rejects.toBeInstanceOf(LockedError);
    await expect(locked.create(draft)).rejects.toBeInstanceOf(LockedError);
    await expect(
      locked.update(created.id, { pinned: false }),
    ).rejects.toBeInstanceOf(LockedError);
  });

  describe("versions", () => {
    it("keeps a note's history sealed and reads it back, newest first", async () => {
      const created = await adapter.create(draft);
      await adapter.saveVersion(created.id, { title: "One", content: "First" });
      await adapter.saveVersion(created.id, { title: "Two", content: "Later" });
      expect(server.dump()).not.toContain("First");
      const versions = await adapterFor(keys).listVersions(created.id);
      expect(versions.map((v) => [v.title, v.content])).toEqual([
        ["Two", "Later"],
        ["One", "First"],
      ]);
    });

    it("leaves out a version that was moved from another note", async () => {
      const a = await adapter.create(draft);
      const b = await adapter.create(draft);
      await adapter.saveVersion(a.id, { title: "A", content: "of a" });
      server.versions.set(
        b.id,
        defined(server.versions.get(a.id)).map((v) => ({ ...v, noteId: b.id })),
      );
      expect(await adapter.listVersions(b.id)).toEqual([]);
    });
  });

  describe("importAll", () => {
    const backup = (id: string, title: string): Note => ({
      ...draft,
      id,
      title,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-02T00:00:00.000Z",
    });

    it("imports sealed, keeping ids and creation times", async () => {
      await adapter.importAll([backup("n1", "First"), backup("n2", "Second")]);
      expect(server.dump()).not.toContain("First");
      const read = await adapterFor(keys).getAll();
      expect(read.map((n) => [n.id, n.title, n.createdAt]).sort()).toEqual([
        ["n1", "First", "2025-01-01T00:00:00.000Z"],
        ["n2", "Second", "2025-01-01T00:00:00.000Z"],
      ]);
    });

    it("writes over a note it already holds under the key that note has", async () => {
      const created = await adapter.create(draft);
      await adapter.saveVersion(created.id, { title: "v", content: "kept" });
      const key = defined(server.notes.get(created.id)).key;

      // A device that has not listed anything yet lists first.
      const fresh = adapterFor(keys);
      await fresh.importAll([backup(created.id, "From the backup")]);

      expect(defined(server.notes.get(created.id)).key).toBe(key);
      expect((await adapter.get(created.id))?.title).toBe("From the backup");
      // Its history is under the same key, so it still opens.
      expect(await adapter.listVersions(created.id)).toHaveLength(1);
    });

    it("seals a note again under a new id when its id is someone else's", async () => {
      server.taken.add("theirs");
      await adapter.importAll([backup("theirs", "Mine now")]);
      const read = await adapterFor(keys).getAll();
      expect(read).toHaveLength(1);
      expect(read[0]?.title).toBe("Mine now");
      expect(read[0]?.id).not.toBe("theirs");
    });
  });
});
