import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageDriver } from "./types.js";

/** The attachment store's rules, run against both drivers. */

const T0 = "2026-04-01T00:00:00.000Z";

export function describeAttachmentsContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: attachments`, () => {
    let storage: StorageDriver;

    const put = (id: string, ownerId: string, bytes: number[]) =>
      storage.attachments.put({
        id,
        ownerId,
        sha256: bytes.join("-"),
        contentType: "image/png",
        data: Buffer.from(bytes),
        createdAt: T0,
      });

    const note = (id: string, userId: string, images: string[]) =>
      storage.notes.insert({
        id,
        userId,
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
          images,
          linkPreviews: [],
          reminder: null,
        },
        createdAt: T0,
        updatedAt: T0,
      });

    beforeEach(async () => {
      storage = await boot();
      for (const [id, username] of [
        ["owner", "olivia"],
        ["alice", "alice"],
      ]) {
        await storage.users.create({
          id,
          username,
          passwordHash: "h",
          displayName: "",
          avatarColor: "",
          provider: "local",
          externalId: null,
          createdAt: T0,
        });
      }
    });

    afterEach(async () => {
      await storage.close();
    });

    it("keeps one copy of the same bytes per owner", async () => {
      const first = await put("01AAAAAAAAAAAAAAAAAAAAAAAA", "owner", [1, 2]);
      const again = await put("01BBBBBBBBBBBBBBBBBBBBBBBB", "owner", [1, 2]);
      const other = await put("01CCCCCCCCCCCCCCCCCCCCCCCC", "alice", [1, 2]);
      expect(again.id).toBe(first.id);
      expect(other.id).not.toBe(first.id);
      const stored = await storage.attachments.get(first.id);
      expect([...(stored?.data ?? [])]).toEqual([1, 2]);
      expect(stored?.size).toBe(2);
    });

    it("lets a recipient read what a shared note refers to", async () => {
      const { id } = await put("01AAAAAAAAAAAAAAAAAAAAAAAA", "owner", [1]);
      await note("n1", "owner", [`attachment:${id}`]);
      expect(await storage.attachments.readableBy(id, "owner")).toBe(true);
      expect(await storage.attachments.readableBy(id, "alice")).toBe(false);
      await storage.shares.create({
        noteId: "n1",
        userId: "alice",
        role: "view",
        createdAt: T0,
      });
      expect(await storage.attachments.readableBy(id, "alice")).toBe(false);
      await storage.shares.accept("n1", "alice", T0);
      expect(await storage.attachments.readableBy(id, "alice")).toBe(true);
    });

    it("marks, keeps, and then deletes an unreferenced attachment", async () => {
      const kept = await put("01AAAAAAAAAAAAAAAAAAAAAAAA", "owner", [1]);
      const lost = await put("01BBBBBBBBBBBBBBBBBBBBBBBB", "owner", [2]);
      await note("n1", "owner", [`attachment:${kept.id}`]);
      expect(await storage.attachments.sweep("2026-05-01", "2000-01-01")).toBe(
        0,
      );
      expect(await storage.attachments.sweep("2026-06-01", "2026-04-15")).toBe(
        0,
      );
      expect(await storage.attachments.sweep("2026-08-01", "2026-06-01")).toBe(
        1,
      );
      expect(await storage.attachments.meta(lost.id)).toBeNull();
      expect(await storage.attachments.meta(kept.id)).not.toBeNull();
    });

    it("finds notes still holding inline images and rewrites them quietly", async () => {
      const inline = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
      await note("n1", "owner", [inline]);
      await note("n2", "owner", []);
      const found = await storage.attachments.notesWithInlineImages(10);
      expect(found).toEqual([{ id: "n1", ownerId: "owner", images: [inline] }]);
      await storage.attachments.setNoteImages("n1", []);
      expect(await storage.attachments.notesWithInlineImages(10)).toEqual([]);
      expect((await storage.notes.getById("n1", "owner"))?.updatedAt).toBe(T0);
    });
  });
}
