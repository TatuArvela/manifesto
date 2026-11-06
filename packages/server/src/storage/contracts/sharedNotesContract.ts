import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EmailTakenError, type StorageDriver } from "#/storage/types.ts";
import { ciphertext, claimed, claimedUpdate, heldKey } from "./claimed.ts";
import {
  noteData,
  PAGE,
  seededSharing,
  shareNote,
  T1,
  T2,
  T3,
  userInput,
} from "./sharingFixture.ts";

/**
 * The second half of the sharing contract (`sharingContract.ts`): a shared
 * note over time. The trash of each side, writes under a key, one listing of
 * own and shared notes, the audience, what goes with a note or a recipient,
 * the collaborative state, and how a person to share with is found.
 */

export function describeSharedNotesContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: shared notes`, () => {
    let storage: StorageDriver;

    beforeEach(async () => {
      storage = await seededSharing(boot);
    });

    afterEach(async () => {
      await storage.close();
    });

    const share = (userId: string, role: "edit" | "view", accept = true) =>
      shareNote(storage, userId, role, accept);

    it("expires a share from its recipient's trash, leaving the note", async () => {
      await share("alice", "edit");
      await share("bob", "edit");
      await storage.notes.update(
        "n1",
        "alice",
        { trashed: true, trashedAt: "2026-01-01T00:00:00.000Z" },
        T3,
      );
      await storage.notes.update(
        "n1",
        "bob",
        { trashed: true, trashedAt: "2026-03-30T00:00:00.000Z" },
        T3,
      );

      const expired = await storage.maintenance.cleanupTrashedSharesBefore(
        "2026-03-01T00:00:00.000Z",
      );
      expect(expired).toMatchObject([{ noteId: "n1", userId: "alice" }]);
      expect(await storage.notes.getById("n1", "alice")).toBeNull();
      expect(await storage.notes.getById("n1", "bob")).not.toBeNull();
      // The person who left still has the key of the note, as after a removal.
      expect((await storage.notes.getById("n1", "owner"))?.rekeyDue).toBe(true);
    });

    it("writes only while the note is under the key the write names", async () => {
      await share("alice", "edit");
      const held = await storage.notes.getById("n1", "owner");
      if (!held) throw new Error("the note is not there");
      const other = held.keyVersion + 1;
      for (const writer of ["owner", "alice"]) {
        expect(
          await storage.notes.update(
            "n1",
            writer,
            { title: ciphertext("sealed under a key that is gone") },
            T3,
            undefined,
            other,
          ),
        ).toBeNull();
      }
      expect((await storage.notes.getById("n1", "owner"))?.updatedAt).toBe(
        held.updatedAt,
      );
      expect(
        await storage.notes.update(
          "n1",
          "alice",
          { title: ciphertext("sealed under the key it has") },
          T3,
          undefined,
          held.keyVersion,
        ),
      ).toMatchObject({ updatedAt: T3 });
    });

    it("hides a note from everyone else while it is in the owner's trash", async () => {
      await share("alice", "edit");
      await share("bob", "view", false);
      await storage.notes.update(
        "n1",
        "owner",
        { trashed: true, trashedAt: T3 },
        T3,
      );

      expect(await storage.notes.getById("n1", "alice")).toBeNull();
      expect(await storage.notes.access("n1", "alice")).toBeNull();
      expect((await storage.notes.listByUser("alice", PAGE)).notes).toEqual([]);
      expect(
        await storage.notes.update("n1", "alice", { pinned: true }, T3),
      ).toBeNull();
      expect(await storage.shares.listInvitations("bob")).toEqual([]);
      expect(await storage.shares.accept("n1", "bob", T3, heldKey)).toBe(false);
      expect((await storage.shares.audience("n1"))?.trashed).toBe(true);

      await storage.notes.update("n1", "owner", { trashed: false }, T3);
      expect(await storage.notes.getById("n1", "alice")).not.toBeNull();
      expect(await storage.shares.listInvitations("bob")).toHaveLength(1);
    });

    it("lists own and shared notes as one ordering, across pages", async () => {
      await share("alice", "edit");
      for (const [id, at] of [
        ["a1", "2026-04-02T00:00:00.000Z"],
        ["a2", "2026-04-04T00:00:00.000Z"],
      ] as const) {
        await storage.notes.insert({
          id,
          userId: "alice",
          data: claimed(noteData),
          createdAt: at,
          updatedAt: at,
        });
      }
      await storage.notes.update(
        "n1",
        "owner",
        claimedUpdate({ title: "Later" }),
        "2026-04-03T00:00:00.000Z",
      );

      const first = await storage.notes.listByUser("alice", { limit: 2 });
      expect(first.notes.map((n) => n.id)).toEqual(["a2", "n1"]);
      expect(first.notes[1]?.sharing?.role).toBe("edit");
      expect(first.nextCursor).not.toBeNull();
      const second = await storage.notes.listByUser("alice", {
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      });
      expect(second.notes.map((n) => n.id)).toEqual(["a1"]);
      expect(second.nextCursor).toBeNull();
    });

    it("changes roles and removes shares, saying what was removed", async () => {
      await share("alice", "edit");
      expect(await storage.shares.setRole("n1", "alice", "view")).toBe(true);
      expect(await storage.notes.access("n1", "alice")).toMatchObject({
        role: "view",
      });
      expect(await storage.shares.setRole("n1", "bob", "view")).toBe(false);

      expect(await storage.shares.delete("n1", "alice")).toMatchObject({
        noteId: "n1",
        userId: "alice",
        role: "view",
        acceptedAt: T2,
      });
      expect(await storage.notes.getById("n1", "alice")).toBeNull();
      expect(await storage.shares.delete("n1", "alice")).toBeNull();
    });

    it("describes a note's audience from both sides", async () => {
      await share("alice", "edit");
      await share("bob", "view", false);
      expect(await storage.shares.audience("n1")).toEqual({
        ownerId: "owner",
        trashed: false,
        shares: [
          {
            noteId: "n1",
            userId: "alice",
            role: "edit",
            createdAt: T1,
            acceptedAt: T2,
            viaTeam: null,
          },
          {
            noteId: "n1",
            userId: "bob",
            role: "view",
            createdAt: T1,
            acceptedAt: null,
            viaTeam: null,
          },
        ],
      });
      expect(await storage.shares.audience("nope")).toBeNull();
      expect(
        (await storage.shares.listByOwner("owner")).map((s) => s.userId),
      ).toEqual(expect.arrayContaining(["alice", "bob"]));
      expect(
        (await storage.shares.listByRecipient("bob")).map((s) => s.noteId),
      ).toEqual(["n1"]);
    });

    it("takes shares along with the note or the recipient", async () => {
      await share("alice", "edit");
      await share("bob", "edit");
      expect(await storage.users.delete("bob")).toBe("ok");
      expect((await storage.shares.audience("n1"))?.shares).toHaveLength(1);

      expect(await storage.notes.delete("n1", "owner")).toBe(true);
      expect(await storage.shares.listByRecipient("alice")).toEqual([]);
    });

    it("keeps collaborative state under the owner", async () => {
      await share("alice", "edit");
      const state = Buffer.from([1, 2, 3]);
      await storage.yjs.store("n1", "owner", state, Buffer.from([4]));
      expect(await storage.yjs.load("n1", "owner")).toEqual(state);
    });

    describe("email", () => {
      it("is optional, unique regardless of case, and found either way", async () => {
        const carol = await storage.users.create(
          userInput("carol", "carol", { email: "Carol@Example.com" }),
        );
        expect(carol.email).toBe("Carol@Example.com");
        expect((await storage.users.findById("alice"))?.email).toBeNull();
        expect((await storage.users.findByEmail("carol@example.COM"))?.id).toBe(
          "carol",
        );

        await expect(
          storage.users.create(
            userInput("dave", "dave", { email: "carol@example.com" }),
          ),
        ).rejects.toBeInstanceOf(EmailTakenError);

        expect(await storage.users.setEmail("alice", "CAROL@example.com")).toBe(
          "email-taken",
        );
        expect(await storage.users.setEmail("alice", "alice@example.com")).toBe(
          "ok",
        );
        expect(await storage.users.setEmail("nope", "x@example.com")).toBe(
          "not-found",
        );
        expect(await storage.users.setEmail("carol", null)).toBe("ok");
        expect(await storage.users.findByEmail("carol@example.com")).toBeNull();
      });

      it("searches usernames, display names and addresses, not the searcher", async () => {
        await storage.users.setEmail("bob", "robert@example.com");
        const ids = async (q: string) =>
          (
            await storage.users.search(q, { excludeId: "alice", limit: 10 })
          ).map((u) => u.id);
        expect(await ids("OLIV")).toEqual(["owner"]);
        expect(await ids("robert")).toEqual(["bob"]);
        expect(await ids("ali")).toEqual([]);
        expect(await ids("%")).toEqual([]);
      });
    });
  });
}
