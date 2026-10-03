import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageDriver, StoredComment } from "../types.js";
import { claimed } from "./claimed.js";

/**
 * Comments, the same in both drivers: kept in the order written, gone with
 * their note, and left behind, with no author, when the author's account goes.
 */

const T0 = "2026-04-01T00:00:00.000Z";
const T1 = "2026-04-01T00:01:00.000Z";
const T2 = "2026-04-01T00:02:00.000Z";

function comment(overrides: Partial<StoredComment> = {}): StoredComment {
  return {
    id: "c1",
    noteId: "n1",
    authorId: "u1",
    body: "First",
    createdAt: T0,
    editedAt: null,
    ...overrides,
  };
}

export function describeCommentsContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: comments`, () => {
    let storage: StorageDriver;

    beforeEach(async () => {
      storage = await boot();
      for (const id of ["u1", "u2"]) {
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
      for (const id of ["n1", "n2"]) {
        await storage.notes.insert({
          id,
          userId: "u1",
          data: claimed({
            title: id,
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
      }
    });

    afterEach(async () => {
      await storage.close();
    });

    it("lists a note's comments oldest first, and counts them", async () => {
      await storage.comments.create(comment({ id: "c2", createdAt: T1 }));
      await storage.comments.create(comment());
      await storage.comments.create(comment({ id: "c3", noteId: "n2" }));

      expect(
        (await storage.comments.listByNote("n1")).map((c) => c.id),
      ).toEqual(["c1", "c2"]);
      expect(await storage.comments.countByNote("n1")).toBe(2);
      expect(await storage.comments.countByNote("n2")).toBe(1);
      expect(await storage.comments.get("c1")).toEqual(comment());
      expect(await storage.comments.get("nope")).toBeNull();
    });

    it("changes a comment's text and says when", async () => {
      await storage.comments.create(comment());
      expect(await storage.comments.setBody("c1", "Second", T2)).toBe(true);
      expect(await storage.comments.get("c1")).toEqual(
        comment({ body: "Second", editedAt: T2 }),
      );
      expect(await storage.comments.setBody("nope", "x", T2)).toBe(false);
    });

    it("deletes one comment, once", async () => {
      await storage.comments.create(comment());
      expect(await storage.comments.delete("c1")).toBe(true);
      expect(await storage.comments.delete("c1")).toBe(false);
      expect(await storage.comments.countByNote("n1")).toBe(0);
    });

    it("keeps a comment whose author's account is gone, with no author", async () => {
      await storage.comments.create(comment({ authorId: "u2" }));
      await storage.users.delete("u2");
      expect(await storage.comments.get("c1")).toEqual(
        comment({ authorId: null }),
      );
    });

    it("removes a note's comments with the note", async () => {
      await storage.comments.create(comment());
      await storage.comments.create(comment({ id: "c3", noteId: "n2" }));
      expect(await storage.notes.delete("n1", "u1")).toBe(true);
      expect(await storage.comments.get("c1")).toBeNull();
      expect(await storage.comments.get("c3")).not.toBeNull();
    });
  });
}
