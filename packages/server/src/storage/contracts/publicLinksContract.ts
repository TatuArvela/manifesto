import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageDriver, StoredPublicLink } from "../types.js";
import { claimed, ct } from "./claimed.js";

/**
 * Public links, the same in both drivers: a view is counted only while the
 * link can still be viewed, and a snapshot that can still be viewed keeps the
 * pictures it shows from the attachment sweep.
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
    wrappedKey: ct("the note key, for the link"),
    sealedLinkKey: ct("the link key, for its owner"),
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
          title: ct("t"),
          content: ct("c"),
          font: ct("default"),
          images: ct("[]"),
          linkPreviews: ct("[]"),
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
        key: ct(`key ${keyVersion}`),
        previousKeys: ct("before"),
        title: ct("t"),
        content: ct("c"),
        excerpt: ct("c"),
        font: ct("default"),
        images: ct("[]"),
        linkPreviews: ct("[]"),
      });

      // A snapshot holds no key of the note's.
      await storage.publicLinks.create(
        link({ token: "copy", mode: "snapshot", wrappedKey: null }),
      );
      await storage.publicLinks.delete("copy", "n1");
      expect(await due()).toBe(false);

      await storage.publicLinks.create(link({ token: "gone" }));
      await storage.publicLinks.create(link({ token: "stays" }));
      await storage.publicLinks.delete("gone", "n1");
      expect(await due()).toBe(true);

      // Only from the version it is at, and only by its owner.
      expect(await storage.notes.rekey("n1", "owner", rekeyed(3), 2, T1)).toBe(
        false,
      );
      expect(await storage.notes.rekey("n1", "else", rekeyed(2), 1, T1)).toBe(
        false,
      );
      expect(await storage.notes.rekey("n1", "owner", rekeyed(2), 1, T1)).toBe(
        true,
      );
      expect(await storage.notes.getById("n1", "owner")).toMatchObject({
        keyVersion: 2,
        key: ct("key 2"),
        previousKeys: ct("before"),
        title: ct("t"),
        updatedAt: T1,
      });
      expect(await due()).toBe(false);
      expect(await storage.publicLinks.rewrap("stays", "n1", ct("again"))).toBe(
        true,
      );
      expect((await storage.publicLinks.get("stays"))?.wrappedKey).toBe(
        ct("again"),
      );
      expect(await storage.publicLinks.rewrap("nope", "n1", ct("x"))).toBe(
        false,
      );

      // Someone who accepted held the key; someone only invited, without
      // one offered, did not.
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
        key: ct("held"),
        keyVersion: 2,
      });
      // Not the recipient's to be told.
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
          // What the copy shows is sealed; the references are what the
          // sweep reads.
          snapshot: {
            title: ct(""),
            content: ct(""),
            font: ct("default"),
            images: ct("sealed list"),
            linkPreviews: ct("[]"),
            refs: [`attachment:${IMAGE_ID}`],
            updatedAt: T0,
          },
        }),
      );
      // Twice past the grace, while the snapshot can still be viewed.
      await storage.attachments.sweep("2026-05-01", "2000-01-01");
      await storage.attachments.sweep("2026-06-01", "2026-05-15");
      expect(await storage.attachments.meta(IMAGE_ID)).not.toBeNull();

      // Once it has expired, the picture is no one's.
      await storage.attachments.sweep("2026-08-01", "2000-01-01");
      expect(await storage.attachments.sweep("2026-12-01", "2026-09-01")).toBe(
        1,
      );
      expect(await storage.attachments.meta(IMAGE_ID)).toBeNull();
    });
  });
}
