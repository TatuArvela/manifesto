import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nowIso } from "../../lib/time.js";
import type { StorageDriver } from "../types.js";
import { claimed } from "./claimed.js";

/**
 * What `GET /api/sync` reads, run against both drivers: which notes count as
 * changed since a time, and which ids a user can see. A driver that misses a
 * membership change leaves a recipient's device showing the wrong role, or a
 * note that is no longer theirs, until the next full reload.
 */

const T0 = "2026-04-01T00:00:00.000Z";
const T1 = "2026-04-01T00:00:01.000Z";
/** After everything seeded, and before any stamp taken from the clock. */
const SINCE = "2026-04-01T00:00:10.000Z";
const T2 = "2026-04-01T00:00:20.000Z";
const PAGE = { limit: 50 };

const noteData = {
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

export function describeSyncContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: sync`, () => {
    let storage: StorageDriver;

    beforeEach(async () => {
      storage = await boot();
      for (const id of ["owner", "alice"]) {
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
      }
      for (const id of ["old", "shared"]) {
        await storage.notes.insert({
          id,
          userId: "owner",
          data: claimed({ ...noteData, title: id }),
          createdAt: T0,
          updatedAt: T0,
        });
      }
      await storage.shares.create({
        noteId: "shared",
        userId: "alice",
        role: "edit",
        createdAt: T1,
      });
    });

    afterEach(async () => {
      await storage.close();
    });

    const changed = async (userId: string) =>
      (await storage.notes.listChanged(userId, SINCE, PAGE)).notes.map(
        (n) => n.id,
      );

    it("lists a note whose row changed, and not one that did not", async () => {
      expect(await changed("owner")).toEqual([]);
      await storage.notes.update("old", "owner", { title: "new" }, T2);
      expect(await changed("owner")).toEqual(["old"]);
      expect(
        (await storage.notes.listChanged("owner", "", PAGE)).notes,
      ).toHaveLength(2);
    });

    it("lists a note whose members changed, for everyone on it", async () => {
      expect(await storage.shares.accept("shared", "alice", T2)).toBe(true);
      expect(await changed("owner")).toEqual(["shared"]);
      expect(await changed("alice")).toEqual(["shared"]);
    });

    it("stamps a role change and a removal", async () => {
      await storage.shares.accept("shared", "alice", T1);
      expect(await changed("owner")).toEqual([]);

      await storage.shares.setRole("shared", "alice", "view");
      expect(await changed("alice")).toEqual(["shared"]);

      // After the role change's stamp, which comes from the same clock.
      const later = nowIso();
      expect(
        (await storage.notes.listChanged("owner", later, PAGE)).notes,
      ).toEqual([]);
      await storage.shares.delete("shared", "alice");
      expect(
        (await storage.notes.listChanged("owner", later, PAGE)).notes.map(
          (n) => n.id,
        ),
      ).toEqual(["shared"]);
    });

    it("stamps a share that expires from its recipient's trash", async () => {
      await storage.shares.accept("shared", "alice", T1);
      await storage.notes.update(
        "shared",
        "alice",
        { trashed: true, trashedAt: T1 },
        T1,
      );
      expect(await changed("owner")).toEqual([]);

      await storage.maintenance.cleanupTrashedSharesBefore(T2);
      expect(await changed("owner")).toEqual(["shared"]);
    });

    it("gives the ids of own notes and accepted shares the owner has not trashed", async () => {
      const ids = async (userId: string) =>
        (await storage.notes.visibleIds(userId)).sort();
      expect(await ids("owner")).toEqual(["old", "shared"]);
      expect(await ids("alice")).toEqual([]);

      await storage.shares.accept("shared", "alice", T1);
      expect(await ids("alice")).toEqual(["shared"]);

      await storage.notes.update("shared", "owner", { trashed: true }, T2);
      expect(await ids("alice")).toEqual([]);
      expect(await ids("owner")).toEqual(["old", "shared"]);
    });
  });
}
