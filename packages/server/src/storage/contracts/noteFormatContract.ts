import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nowIso } from "#/lib/time.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { claimed, claimedUpdate, heldKey } from "./claimed.ts";

/**
 * The format a note's words are in, run against both drivers: a write is held
 * to it in the statement that writes, so an app older than the one that wrote
 * a note never stores words over it, and a note never holds words in two
 * formats at once (`formatCondition` in `noteMapping.ts`).
 */

const T0 = "2026-04-01T00:00:00.000Z";
const T1 = "2026-04-01T00:00:01.000Z";

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

/** Every word of a note, as a write that moves it to `format` sends them. */
function everyWord(title: string, format: number) {
  return {
    ...claimedUpdate({
      title,
      content: "",
      font: NoteFont.Default,
      images: [],
      linkPreviews: [],
    }),
    format,
  };
}

export function describeNoteFormatContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: note format`, () => {
    let storage: StorageDriver;

    beforeEach(async () => {
      storage = await boot();
      for (const id of ["owner", "editor"]) {
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
      await storage.notes.insert({
        id: "note",
        userId: "owner",
        data: claimed({ ...noteData, title: "First" }),
        createdAt: T0,
        updatedAt: T0,
      });
      await storage.shares.create({
        noteId: "note",
        userId: "editor",
        role: "edit",
        createdAt: T0,
      });
      await storage.shares.accept("note", "editor", T0, heldKey);
    });

    afterEach(async () => {
      await storage.close();
    });

    const formatOf = async (userId = "owner") =>
      (await storage.notes.getById("note", userId))?.format;

    it("stores format 1 for a note written before formats", async () => {
      expect(await formatOf()).toBe(1);
      expect(await formatOf("editor")).toBe(1);
    });

    for (const userId of ["owner", "editor"]) {
      describe(`written by the ${userId}`, () => {
        it("takes words in the note's own format", async () => {
          const written = await storage.notes.update(
            "note",
            userId,
            { ...claimedUpdate({ title: "Second" }), format: 1 },
            T1,
          );
          expect(written?.format).toBe(1);
        });

        it("moves the note to a newer format with every word, and not with a part", async () => {
          expect(
            await storage.notes.update(
              "note",
              userId,
              { ...claimedUpdate({ title: "Part" }), format: 2 },
              T1,
            ),
          ).toBeNull();
          expect(await formatOf()).toBe(1);

          const moved = await storage.notes.update(
            "note",
            userId,
            everyWord("Whole", 2),
            T1,
          );
          expect(moved?.format).toBe(2);
        });

        it("refuses words older than the note's, a part or all of them", async () => {
          await storage.notes.update("note", "owner", everyWord("New", 2), T1);
          for (const changes of [
            { ...claimedUpdate({ title: "Old" }), format: 1 },
            everyWord("Old", 1),
          ]) {
            expect(
              await storage.notes.update("note", userId, changes, T1),
            ).toBeNull();
          }
          expect(await formatOf()).toBe(2);
        });

        it("lets a write without words through whatever the format", async () => {
          await storage.notes.update("note", "owner", everyWord("New", 2), T1);
          const pinned = await storage.notes.update(
            "note",
            userId,
            { pinned: true },
            T1,
          );
          expect(pinned?.pinned).toBe(true);
          expect(pinned?.format).toBe(2);
        });
      });
    }

    it("keeps each version's format", async () => {
      for (const [id, format] of [
        ["v1", 1],
        ["v2", 2],
      ] as const) {
        await storage.versions.add({
          id,
          noteId: "note",
          authorId: "owner",
          keyVersion: 1,
          format,
          title: "t",
          content: "c",
          // From the clock: a version older than the age limit goes at once.
          createdAt: nowIso(),
        });
      }
      const formats = (await storage.versions.list("note")).map((v) => [
        v.id,
        v.format,
      ]);
      expect(formats).toEqual(
        expect.arrayContaining([
          ["v1", 1],
          ["v2", 2],
        ]),
      );
    });
  });
}
