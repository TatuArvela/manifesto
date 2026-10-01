import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageDriver, StoredPublicLink } from "../types.js";
import { claimedImages, claimedPreviews } from "./claimed.js";

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
        data: {
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
          images: claimedImages([]),
          linkPreviews: claimedPreviews([]),
          reminder: null,
        },
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
        snapshot: {
          title: "t",
          content: "c",
          color: NoteColor.Blue,
          font: NoteFont.Default,
          images: [],
          linkPreviews: [],
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
          snapshot: {
            title: "",
            content: "",
            color: NoteColor.Default,
            font: NoteFont.Default,
            images: [`attachment:${IMAGE_ID}`],
            linkPreviews: [],
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
