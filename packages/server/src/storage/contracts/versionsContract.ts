import { MAX_NOTE_VERSIONS, NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageDriver, VersionsRepo } from "#/storage/types.ts";
import { claimed } from "./claimed.ts";

/**
 * Note versions, the same in both drivers: an id is written one time, and a
 * note keeps only its newest `MAX_NOTE_VERSIONS`.
 */

const T0 = "2026-04-01T00:00:00.000Z";

type VersionInput = Parameters<VersionsRepo["add"]>[0];

/** Version `i`, `i` seconds after a recent start, inside the age limit. */
function version(i: number, start: number): VersionInput {
  return {
    id: `v${String(i).padStart(3, "0")}`,
    noteId: "n1",
    authorId: "u1",
    keyVersion: 1,
    format: 1,
    title: `title ${i}`,
    content: "",
    createdAt: new Date(start + i * 1000).toISOString(),
  };
}

export function describeVersionsContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: note versions`, () => {
    let storage: StorageDriver;
    const start = Date.now() - 60 * 60 * 1000;

    beforeEach(async () => {
      storage = await boot();
      await storage.users.create({
        id: "u1",
        username: "u1",
        passwordHash: "h",
        displayName: "",
        avatarColor: "#123456",
        provider: "local",
        externalId: null,
        createdAt: T0,
      });
      await storage.notes.insert({
        id: "n1",
        userId: "u1",
        data: claimed({
          title: "n1",
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

    it("refuses a second version with the same id, and keeps the first", async () => {
      expect(await storage.versions.add(version(1, start))).toBe(true);
      expect(
        await storage.versions.add({ ...version(1, start), title: "other" }),
      ).toBe(false);
      const list = await storage.versions.list("n1");
      expect(list.map((v) => v.title)).toEqual(["title 1"]);
    });

    it("keeps only the newest versions of a note", async () => {
      for (let i = 0; i <= MAX_NOTE_VERSIONS; i++) {
        await storage.versions.add(version(i, start));
      }
      const ids = (await storage.versions.list("n1")).map((v) => v.id);
      expect(ids).toHaveLength(MAX_NOTE_VERSIONS);
      expect(ids[0]).toBe(version(MAX_NOTE_VERSIONS, start).id);
      expect(ids).not.toContain(version(0, start).id);
    });
  });
}
