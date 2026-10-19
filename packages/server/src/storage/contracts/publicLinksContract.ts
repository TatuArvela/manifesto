import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageDriver, StoredPublicLink } from "#/storage/types.ts";
import { ciphertext, claimed } from "./claimed.ts";

/**
 * Public links, the same in both drivers: a view counts only while the link can
 * still be viewed. A snapshot that can still be viewed keeps its pictures safe
 * from the attachment sweep.
 */

const T0 = "2026-04-01T00:00:00.000Z";
const T1 = "2026-04-02T00:00:00.000Z";
const T2 = "2026-04-03T00:00:00.000Z";
const IMAGE_ID = "01AAAAAAAAAAAAAAAAAAAAAAAA";

function link(overrides: Partial<StoredPublicLink> = {}): StoredPublicLink {
  return {
    token: "tok",
    noteId: "n1",
    ownerId: "owner",
    mode: "live",
    snapshot: null,
    passwordHash: null,
    hasPassword: false,
    expiresAt: null,
    maxViews: null,
    viewCount: 0,
    lastViewedAt: null,
    createdAt: T0,
    wrappedKey: ciphertext("the note key, for the link"),
    sealedLinkKey: ciphertext("the link key, for its owner"),
    ...overrides,
  };
}

export function describePublicLinksContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: public links`, () => {
    let storage: StorageDriver;

    beforeEach(async () => {
      storage = await boot();
      await storage.users.create({
        id: "owner",
        username: "owner",
        passwordHash: "h",
        displayName: "",
        avatarColor: "#123456",
        provider: "local",
        externalId: null,
        createdAt: T0,
      });
      await storage.notes.insert({
        id: "n1",
        userId: "owner",
        data: claimed({
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
        }),
        createdAt: T0,
        updatedAt: T0,
      });
    });

    afterEach(async () => {
      await storage.close();
    });

    it("stores, lists, reads back and revokes a link", async () => {
      const made = link({
        mode: "snapshot",
        wrappedKey: null,
        snapshot: {
          title: ciphertext("t"),
          content: ciphertext("c"),
          font: ciphertext("default"),
          images: ciphertext("[]"),
          linkPreviews: ciphertext("[]"),
          refs: [],
          updatedAt: T0,
        },
        passwordHash: "hash",
        hasPassword: true,
        maxViews: 3,
      });
      await storage.publicLinks.create(made);
      expect(await storage.publicLinks.get("tok")).toEqual(made);
      expect(await storage.publicLinks.listByNote("n1")).toEqual([made]);
      expect(await storage.publicLinks.delete("tok", "other")).toBe(false);
      expect(await storage.publicLinks.delete("tok", "n1")).toBe(true);
      expect(await storage.publicLinks.get("tok")).toBeNull();
    });

    it("counts views only up to the limit and before the expiry", async () => {
      await storage.publicLinks.create(link({ maxViews: 2 }));
      expect(await storage.publicLinks.recordView("tok", T0)).toBe(true);
      expect(await storage.publicLinks.recordView("tok", T1)).toBe(true);
      expect(await storage.publicLinks.recordView("tok", T1)).toBe(false);
      expect(await storage.publicLinks.get("tok")).toMatchObject({
        viewCount: 2,
        lastViewedAt: T1,
      });

      await storage.publicLinks.create(link({ token: "t2", expiresAt: T1 }));
      expect(await storage.publicLinks.recordView("t2", T0)).toBe(true);
      expect(await storage.publicLinks.recordView("t2", T2)).toBe(false);
    });

    it("goes with its note", async () => {
      await storage.publicLinks.create(link());
      await storage.notes.delete("n1", "owner");
      expect(await storage.publicLinks.get("tok")).toBeNull();
    });

    it("leaves the note due a new key when a live link or a key's holder goes, until it is given one", async () => {
      const due = async () =>
        (await storage.notes.getById("n1", "owner"))?.rekeyDue === true;
      const rekeyed = (keyVersion: number) => ({
        keyVersion,
        key: ciphertext(`key ${keyVersion}`),
        previousKeys: ciphertext("before"),
        title: ciphertext("t"),
        content: ciphertext("c"),
        excerpt: ciphertext("c"),
        font: ciphertext("default"),
        images: ciphertext("[]"),
        linkPreviews: ciphertext("[]"),
      });

      // A snapshot contains no key of the note.
      await storage.publicLinks.create(
        link({ token: "copy", mode: "snapshot", wrappedKey: null }),
      );
      await storage.publicLinks.delete("copy", "n1");
      expect(await due()).toBe(false);

      await storage.publicLinks.create(link({ token: "gone" }));
      await storage.publicLinks.create(link({ token: "stays" }));
      await storage.publicLinks.delete("gone", "n1");
      expect(await due()).toBe(true);

      // Only from its current version, only by its owner, and only while the
      // note is as it was read.
      const read =
        (await storage.notes.getById("n1", "owner"))?.updatedAt ?? "";
      const rewrapped = [
        { token: "stays", wrappedKey: ciphertext("again") },
        { token: "nope", wrappedKey: ciphertext("x") },
      ];
      const rekey = (owner: string, to: number, from: number, at = read) =>
        storage.notes.rekey("n1", owner, rekeyed(to), from, T1, at, rewrapped);
      expect(await rekey("owner", 3, 2)).toBe(false);
      expect(await rekey("else", 2, 1)).toBe(false);
      expect(await rekey("owner", 2, 1, "2001-01-01T00:00:00.000Z")).toBe(
        false,
      );
      expect((await storage.notes.getById("n1", "owner"))?.keyVersion).toBe(1);
      // A refused move leaves the links on their previous key.
      expect((await storage.publicLinks.get("stays"))?.wrappedKey).not.toBe(
        ciphertext("again"),
      );
      expect(await rekey("owner", 2, 1)).toBe(true);
      expect(await storage.notes.getById("n1", "owner")).toMatchObject({
        keyVersion: 2,
        key: ciphertext("key 2"),
        previousKeys: ciphertext("before"),
        title: ciphertext("t"),
        updatedAt: T1,
      });
      expect(await due()).toBe(false);
      // The live link moved with the note. The named link that is not there was
      // skipped.
      expect((await storage.publicLinks.get("stays"))?.wrappedKey).toBe(
        ciphertext("again"),
      );
      expect(await storage.publicLinks.get("nope")).toBeNull();

      // A person who accepted had the key. A person who was only invited,
      // without an offer, did not.
      for (const id of ["alice", "bob"]) {
        await storage.users.create({
          id,
          username: id,
          passwordHash: "h",
          displayName: "",
          avatarColor: "#123456",
          provider: "local",
          externalId: null,
          createdAt: T0,
        });
        await storage.shares.create({
          noteId: "n1",
          userId: id,
          role: "view",
          createdAt: T0,
        });
      }
      await storage.shares.delete("n1", "bob");
      expect(await due()).toBe(false);
      await storage.shares.accept("n1", "alice", T0, {
        key: ciphertext("held"),
        keyVersion: 2,
      });
      // The recipient must not get this.
      await storage.shares.delete("n1", "alice");
      expect(await due()).toBe(true);
    });

    it("keeps a usable snapshot's pictures from the sweep, and lets an expired one's go", async () => {
      await storage.attachments.put({
        id: IMAGE_ID,
        ownerId: "owner",
        sha256: "x",
        contentType: "image/png",
        data: Buffer.from([1]),
        createdAt: T0,
      });
      await storage.publicLinks.create(
        link({
          mode: "snapshot",
          expiresAt: "2026-07-01T00:00:00.000Z",
          wrappedKey: null,
          // What the copy shows is sealed. The sweep reads the references.
          snapshot: {
            title: ciphertext(""),
            content: ciphertext(""),
            font: ciphertext("default"),
            images: ciphertext("sealed list"),
            linkPreviews: ciphertext("[]"),
            refs: [`attachment:${IMAGE_ID}`],
            updatedAt: T0,
          },
        }),
      );
      // Two times past the grace, while the snapshot can still be viewed.
      await storage.attachments.sweep("2026-05-01", "2000-01-01");
      await storage.attachments.sweep("2026-06-01", "2026-05-15");
      expect(await storage.attachments.meta(IMAGE_ID)).not.toBeNull();

      // After it expired, the picture belongs to nobody.
      await storage.attachments.sweep("2026-08-01", "2000-01-01");
      expect(await storage.attachments.sweep("2026-12-01", "2026-09-01")).toBe(
        1,
      );
      expect(await storage.attachments.meta(IMAGE_ID)).toBeNull();
    });
  });
}
