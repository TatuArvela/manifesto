import { NoteColor, NoteFont } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import type { StorageDriver } from "./types.js";

/** The admin overview's counts, the same from both drivers. */
export function describeStatsContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: stats`, () => {
    it("counts notes, attachments and bytes per account and in total", async () => {
      const storage = await boot();
      const T = "2026-04-01T00:00:00.000Z";
      for (const [id, username] of [
        ["u1", "una"],
        ["u2", "ursula"],
      ]) {
        await storage.users.create({
          id,
          username,
          passwordHash: "h",
          displayName: "",
          avatarColor: "",
          provider: "local",
          externalId: null,
          createdAt: T,
        });
      }
      const note = (id: string, userId: string, trashed = false) =>
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
            trashed,
            trashedAt: trashed ? T : null,
            position: 0,
            tags: [],
            images: [],
            linkPreviews: [],
            reminder: null,
          },
          createdAt: T,
          updatedAt: T,
        });
      await note("n1", "u1");
      await note("n2", "u1", true);
      await note("n3", "u2");
      await storage.attachments.put({
        id: "01AAAAAAAAAAAAAAAAAAAAAAAA",
        ownerId: "u2",
        sha256: "a",
        contentType: "image/png",
        data: Buffer.alloc(100),
        createdAt: T,
      });
      const stats = await storage.maintenance.stats();
      expect(stats.totals).toEqual({
        users: 2,
        notes: 3,
        trashedNotes: 1,
        shares: 0,
        attachments: 1,
        attachmentBytes: 100,
        versions: 0,
      });
      expect(stats.perUser).toEqual([
        { userId: "u2", notes: 1, attachments: 1, attachmentBytes: 100 },
        { userId: "u1", notes: 2, attachments: 0, attachmentBytes: 0 },
      ]);
      await storage.close();
    });
  });
}
