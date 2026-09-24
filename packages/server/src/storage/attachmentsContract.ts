import { type LinkPreview, NoteColor, NoteFont } from "@manifesto/shared";
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

    const note = (
      id: string,
      userId: string,
      images: string[],
      linkPreviews: LinkPreview[] = [],
    ) =>
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
          linkPreviews,
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

    it("counts a preview's thumbnail and favicon as references", async () => {
      const thumb = await put("01AAAAAAAAAAAAAAAAAAAAAAAA", "owner", [1]);
      const icon = await put("01BBBBBBBBBBBBBBBBBBBBBBBB", "owner", [2]);
      const named = await put("01CCCCCCCCCCCCCCCCCCCCCCCC", "owner", [3]);
      await note(
        "n1",
        "owner",
        [],
        [
          {
            url: "https://example.com/",
            // A title is free text: naming an attachment there refers to nothing.
            title: `attachment:${named.id}`,
            image: `attachment:${thumb.id}`,
            favicon: `attachment:${icon.id}`,
            domain: "example.com",
          },
        ],
      );
      await storage.shares.create({
        noteId: "n1",
        userId: "alice",
        role: "view",
        createdAt: T0,
      });
      await storage.shares.accept("n1", "alice", T0);
      expect(await storage.attachments.readableBy(thumb.id, "alice")).toBe(
        true,
      );
      expect(await storage.attachments.readableBy(icon.id, "alice")).toBe(true);
      expect(await storage.attachments.readableBy(named.id, "alice")).toBe(
        false,
      );
      await storage.attachments.sweep("2026-05-01", "2000-01-01");
      await storage.attachments.sweep("2026-08-01", "2026-06-01");
      expect(await storage.attachments.meta(thumb.id)).not.toBeNull();
      expect(await storage.attachments.meta(icon.id)).not.toBeNull();
    });
  });
}
