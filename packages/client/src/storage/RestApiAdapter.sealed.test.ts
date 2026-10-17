import {
  type AccountKeys,
  type Note,
  NoteColor,
  type NoteCreate,
  NoteFont,
  type SealedNote,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "#/test/defined.ts";
import { SealedServer, testKeys } from "#/test/sealedServer.ts";
import { createAccountKeys } from "#/utils/keyMaterial.ts";
import { ImageKindError } from "./imageKeyRing.ts";
import { NoteConflictError, RestApiAdapter } from "./RestApiAdapter.ts";
import {
  LockedError,
  Sealer,
  type StorageKeys,
  setOfferHandler,
} from "./sealing.ts";

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

  describe("a note whose key was replaced", () => {
    afterEach(() => {
      setOfferHandler(null);
    });

    it("seals a change again under the new key, once the server refuses the old", async () => {
      const created = await adapter.create(draft);
      const before = defined(server.notes.get(created.id));
      const made = await new Sealer(keys).rekey(before, []);
      if (!made) throw new Error("not replaced");
      server.notes.set(created.id, { ...before, ...made.body });

      const saved = await adapter.update(created.id, { title: "After" });
      expect(saved.title).toBe("After");
      expect(defined(server.notes.get(created.id)).keyVersion).toBe(2);
      expect((await adapterFor(keys).get(created.id))?.title).toBe("After");
    });

    it("takes the key a recipient is offered before sealing again", async () => {
      // Two accounts with keys to wrap to and sign with.
      const account = async (userId: string) => {
        const made = await createAccountKeys(userId);
        const held: AccountKeys = {
          version: made.version,
          wrappedBySecret: made.request.wrappedBySecret,
          publicKeys: made.request.publicKeys,
          wrappedPrivateKeys: made.request.wrappedPrivateKeys,
        };
        return {
          userId,
          publicKeys: held.publicKeys,
          load: async () => held,
          sealer: new Sealer({
            userId,
            version: made.version,
            accountKey: made.accountKey,
          }),
        };
      };
      const owner = await account("u-owner");
      const alice = await account("u-alice");
      const offerTo = async (from: SealedNote) => {
        const offered = await owner.sealer.offerKey(
          "n1",
          { userId: alice.userId, exchange: alice.publicKeys.exchange },
          async () => from,
          owner.load,
        );
        if (!offered) throw new Error("no offer");
        return offered;
      };
      // As `shareKeys.ts` does, without the requests around it.
      setOfferHandler(async (sealing, sealed) => {
        if (!sealed.offered) return;
        await sealing.adoptOffered(
          sealed.id,
          sealed.offered,
          owner.publicKeys.signing,
          alice.load,
        );
      });

      const {
        imageRefs: _i,
        previewRefs: _p,
        ...sealed
      } = await owner.sealer.sealNew("n1", draft);
      const first: SealedNote = { ...sealed, createdAt: "c", updatedAt: "u" };
      server.notes.set("n1", first);
      // Alice accepted, and keeps her own copy of the first key.
      const kept = await alice.sealer.adoptOffered(
        "n1",
        await offerTo(first),
        owner.publicKeys.signing,
        alice.load,
      );
      server.views.set("n1", { key: defined(kept?.key) });
      const hers = new RestApiAdapter("http://server.test", "tok", {
        sealer: alice.sealer,
      });
      expect((await hers.get("n1"))?.title).toBe("Groceries");

      // The owner replaces the key and offers Alice the new one; her device
      // has not read the note since.
      const made = await owner.sealer.rekey(first, []);
      if (!made) throw new Error("not replaced");
      made.commit();
      const second = { ...first, ...made.body };
      server.notes.set("n1", second);
      server.views.set("n1", { key: "", offered: await offerTo(second) });

      const saved = await hers.update("n1", { title: "From Alice" });
      expect(saved.title).toBe("From Alice");
      const now = defined(server.notes.get("n1"));
      expect(now.keyVersion).toBe(2);
      expect((await owner.sealer.open(now))?.title).toBe("From Alice");
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

    it("seals again under the key a note has now when it was replaced meanwhile", async () => {
      const created = await adapter.create(draft);
      await adapter.getAll();
      // Another device of the account replaces the key: someone left.
      const before = defined(server.notes.get(created.id));
      const made = await new Sealer(keys).rekey(before, []);
      if (!made) throw new Error("not replaced");
      server.notes.set(created.id, { ...before, ...made.body });

      // This one still holds the key before, which whoever left holds too.
      await adapter.importAll([backup(created.id, "From the backup")]);

      const after = defined(server.notes.get(created.id));
      expect(after.keyVersion).toBe(2);
      expect(after.key).toBe(made.body.key);
      expect(after.previousKeys).toBe(made.body.previousKeys);
      expect((await adapterFor(keys).get(created.id))?.title).toBe(
        "From the backup",
      );
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

  describe("images", () => {
    // A one-pixel PNG, and the start of a GIF.
    const PNG = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    );
    const GIF = new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000");
    const blob = (bytes: Uint8Array<ArrayBuffer>, type: string) =>
      new Blob([bytes], { type });
    const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

    let sealer: Sealer;
    let mine: RestApiAdapter;

    beforeEach(() => {
      sealer = new Sealer(keys);
      mine = new RestApiAdapter("http://server.test", "tok", { sealer });
    });

    /** An upload as `putImage` makes it, which a test without a browser
     * cannot send: sealed here, stored on the server, its key kept. */
    async function upload(
      with_: Sealer,
      image: Blob,
      owner = "me",
    ): Promise<string> {
      const sealed = await with_.sealUpload(image);
      const ref = server.putAttachment(await bytesOf(sealed.body), owner);
      with_.keepImageKey(ref, sealed.key);
      return ref;
    }

    it("seals an image so the server holds bytes it cannot read, and opens it again", async () => {
      const sealed = await sealer.sealUpload(blob(PNG, "image/png"));
      const stored = await bytesOf(sealed.body);
      expect(stored.length).toBe(PNG.length + 28);
      // Not the image, nor anything that starts like one.
      expect([...stored.subarray(0, 4)]).not.toEqual([...PNG.subarray(0, 4)]);
      expect(sealed.headers["Content-Type"]).toBe("application/octet-stream");
      expect(sealed.headers["X-Attachment-Address"]).toMatch(
        /^[A-Za-z0-9_-]{43}$/,
      );

      const ref = server.putAttachment(stored);
      sealer.keepImageKey(ref, sealed.key);
      const read = await mine.loadImage(ref);
      expect(read.type).toBe("image/png");
      expect([...(await bytesOf(read))]).toEqual([...PNG]);
    });

    it("finds the same image under the same address for one account, and no other", async () => {
      const address = async (with_: Sealer, bytes: Uint8Array<ArrayBuffer>) =>
        (await with_.sealUpload(blob(bytes, "image/png"))).headers[
          "X-Attachment-Address"
        ];
      expect(await address(sealer, PNG)).toBe(await address(sealer, PNG));
      expect(await address(sealer, GIF)).not.toBe(await address(sealer, PNG));
      const other = new Sealer(await testKeys("u2"));
      expect(await address(other, PNG)).not.toBe(await address(sealer, PNG));
    });

    it("takes what the bytes say an image is, and nothing that is not one", async () => {
      // A PNG handed over as something else is still a PNG.
      const sealed = await sealer.sealUpload(blob(PNG, "text/html"));
      expect(sealed.key?.type).toBe("image/png");
      const svg = new TextEncoder().encode("<svg onload=alert(1)>");
      await expect(
        sealer.sealUpload(blob(svg, "image/png")),
      ).rejects.toBeInstanceOf(ImageKindError);
    });

    it("carries an image's key in the note, for every device that opens it", async () => {
      const ref = await upload(sealer, blob(PNG, "image/png"));
      const created = await mine.create({ ...draft, images: [ref] });
      expect(created.images).toEqual([ref]);
      expect(server.refs.get(created.id)?.imageRefs).toEqual([ref]);
      // The key is nowhere the server can read it.
      const held = defined(server.notes.get(created.id));
      expect(held.images.startsWith("e1.")).toBe(true);

      const otherDevice = adapterFor(keys);
      await expect(otherDevice.loadImage(ref)).rejects.toThrow();
      expect((await otherDevice.getAll())[0]?.images).toEqual([ref]);
      expect((await otherDevice.loadImage(ref)).type).toBe("image/png");

      const stranger = adapterFor(await testKeys("u2"));
      await stranger.getAll();
      await expect(stranger.loadImage(ref)).rejects.toThrow();
    });

    it("carries a preview's thumbnail the same way", async () => {
      const ref = await upload(sealer, blob(PNG, "image/png"));
      const preview = {
        url: "https://example.com/a",
        title: "Example",
        domain: "example.com",
        image: ref,
      };
      const created = await mine.create({ ...draft, linkPreviews: [preview] });
      expect(created.linkPreviews).toEqual([preview]);
      expect(server.refs.get(created.id)?.previewRefs).toEqual([ref]);
      const otherDevice = adapterFor(keys);
      expect((await otherDevice.getAll())[0]?.linkPreviews).toEqual([preview]);
      expect((await otherDevice.loadImage(ref)).type).toBe("image/png");
    });

    it("names the owner's copy of an image that was someone else's", async () => {
      const created = await mine.create(draft);
      // An image this device can open, held by another account: one copied
      // out of a note shared with it.
      const theirs = await upload(sealer, blob(PNG, "image/png"), "other");
      const updated = await mine.update(created.id, { images: [theirs] });
      const [own] = updated.images;
      expect(own).not.toBe(theirs);
      expect(server.refs.get(created.id)?.imageRefs).toEqual([own]);
      // The same sealed bytes, so the key still opens them.
      expect((await mine.loadImage(defined(own))).type).toBe("image/png");
    });

    it("refuses to seal a note that names an image it has no key for", async () => {
      const ref = server.putAttachment(new Uint8Array(40));
      await expect(mine.create({ ...draft, images: [ref] })).rejects.toThrow();
    });

    it("shows nothing for an image that is not what its note says", async () => {
      const sealed = await sealer.sealUpload(blob(GIF, "image/gif"));
      const ref = server.putAttachment(await bytesOf(sealed.body));
      // A note written by someone who lied about the kind of image.
      sealer.keepImageKey(ref, {
        key: sealed.key?.key ?? "",
        type: "image/png",
      });
      await expect(mine.loadImage(ref)).rejects.toThrow();
    });
  });
});
