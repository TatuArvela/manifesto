import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NoteAccessError, type StorageDriver } from "#/storage/types.ts";
import {
  ciphertext,
  claimed,
  claimedUpdate,
  heldKey,
  opened,
} from "./claimed.ts";
import {
  noteData,
  PAGE,
  seededSharing,
  shareNote,
  T0,
  T1,
  T2,
  T3,
} from "./sharingFixture.ts";

/**
 * What both drivers must do for the share of notes between accounts, run
 * against each one, for the same reason as `adminContract.ts`. These are rules
 * about who sees what. A driver that does one incorrectly must fail under its
 * own name, not in the route that notices it first.
 *
 * This half is the invitations, the keys, and what each person on a note can
 * do. `sharedNotesContract.ts` is the other half.
 */
export function describeSharingContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: sharing`, () => {
    let storage: StorageDriver;

    beforeEach(async () => {
      storage = await seededSharing(boot);
    });

    afterEach(async () => {
      await storage.close();
    });

    const share = (userId: string, role: "edit" | "view", accept = true) =>
      shareNote(storage, userId, role, accept);

    it("grants nothing with an invitation until it is accepted", async () => {
      await share("alice", "edit", false);

      expect(await storage.notes.getById("n1", "alice")).toBeNull();
      expect(await storage.notes.access("n1", "alice")).toBeNull();
      expect((await storage.notes.listByUser("alice", PAGE)).notes).toEqual([]);
      expect(await storage.shares.listInvitations("alice")).toEqual([
        {
          noteId: "n1",
          role: "edit",
          owner: {
            id: "owner",
            username: "olivia",
            displayName: "Olivia",
            avatarColor: "#123456",
          },
          // Sealed, as the note is. The color belongs to the owner, and is not
          // part of the offer. Nobody wrapped the key yet.
          title: ciphertext("Groceries"),
          content: ciphertext("- [ ] Milk"),
          font: ciphertext(NoteFont.Default),
          keyVersion: 1,
          offered: null,
          invitedAt: T1,
        },
      ]);
      expect(await storage.shares.getInvitation("n1", "alice")).toMatchObject({
        noteId: "n1",
      });
      expect(await storage.shares.getInvitation("n1", "bob")).toBeNull();
    });

    it("carries a key offered to someone until they keep it as their own", async () => {
      const offered = {
        keyVersion: 1,
        ephemeral: "B".repeat(87),
        wrapped: ciphertext("wrapped to alice"),
        signer: "owner",
        signature: "sig",
      };
      await share("alice", "edit", false);
      // Until a person wraps it for her, all persons on the note see that she
      // waits.
      const waiting = await storage.notes.getById("n1", "owner");
      expect(waiting?.sharing?.members).toMatchObject([
        { id: "alice", waitingForKey: true },
      ]);
      expect(await storage.shares.offerKey("n1", "bob", offered)).toBe(false);
      expect(await storage.shares.offerKey("n1", "alice", offered)).toBe(true);
      expect(
        (await storage.shares.getInvitation("n1", "alice"))?.offered,
      ).toEqual(offered);
      const told = await storage.notes.getById("n1", "owner");
      expect(told?.sharing?.members[0]?.waitingForKey).toBeUndefined();

      // She cannot keep it before she accepted.
      expect(await storage.shares.holdKey("n1", "alice", heldKey)).toBe(false);
      expect(await storage.shares.accept("n1", "alice", T2, heldKey)).toBe(
        true,
      );
      const hers = await storage.notes.getById("n1", "alice");
      expect(hers?.key).toBe(heldKey.key);
      expect(hers?.offered).toBeUndefined();
      expect(
        (await storage.notes.getById("n1", "owner"))?.sharing?.members[0]
          ?.waitingForKey,
      ).toBeUndefined();
    });

    it("refuses a second invitation to the same person", async () => {
      await share("alice", "edit", false);
      expect(
        await storage.shares.create({
          noteId: "n1",
          userId: "alice",
          role: "view",
          createdAt: T2,
        }),
      ).toBe("exists");
    });

    it("gives an accepted recipient the note with fresh personal fields", async () => {
      await share("alice", "edit");

      const seen = await storage.notes.getById("n1", "alice");
      // The color and the tags belong to each person, under their own key.
      // Thus, a recipient starts with neither.
      expect(seen && opened(seen)).toMatchObject({
        title: "Groceries",
        color: NoteColor.Default,
        pinned: false,
        archived: false,
        tags: [],
        reminder: null,
        position: -Date.parse(T2),
        sharing: {
          role: "edit",
          owner: { id: "owner", displayName: "Olivia" },
          members: [{ id: "alice", role: "edit", accepted: true }],
        },
      });
      expect(await storage.notes.access("n1", "alice")).toEqual({
        role: "edit",
        ownerId: "owner",
      });
      expect(await storage.shares.listInvitations("alice")).toEqual([]);
      expect(
        (await storage.notes.listByUser("alice", PAGE)).notes.map((n) => n.id),
      ).toEqual(["n1"]);
      // A second acceptance does not exist.
      expect(await storage.shares.accept("n1", "alice", T3, heldKey)).toBe(
        false,
      );
    });

    it("tells the owner about invitations and recipients only about members", async () => {
      await share("alice", "edit");
      await share("bob", "view", false);

      const owners = await storage.notes.getById("n1", "owner");
      expect(owners?.sharing).toMatchObject({
        role: "owner",
        members: [
          { id: "alice", accepted: true },
          { id: "bob", role: "view", accepted: false },
        ],
      });
      const alices = await storage.notes.getById("n1", "alice");
      expect(alices?.sharing?.members.map((m) => m.id)).toEqual(["alice"]);
      // A note to which nobody was invited has no `sharing`.
      await storage.notes.insert({
        id: "n2",
        userId: "owner",
        data: claimed(noteData),
        createdAt: T0,
        updatedAt: T0,
      });
      expect(
        (await storage.notes.getById("n2", "owner"))?.sharing,
      ).toBeUndefined();
    });

    it("keeps personal fields apart and shares the note itself", async () => {
      await share("alice", "edit");

      const alices = await storage.notes.update(
        "n1",
        "alice",
        claimedUpdate({
          tags: ["errands"],
          pinned: true,
          color: NoteColor.Blue,
          title: "Shopping",
        }),
        T3,
        T0,
      );
      expect(alices && opened(alices)).toMatchObject({
        title: "Shopping",
        tags: ["errands"],
        pinned: true,
        color: NoteColor.Blue,
        updatedAt: T3,
      });

      const owners = await storage.notes.getById("n1", "owner");
      expect(owners && opened(owners)).toMatchObject({
        title: "Shopping",
        tags: ["home"],
        pinned: true,
        color: NoteColor.Yellow,
        position: 5,
        // One concurrency token for all persons.
        updatedAt: T3,
      });
    });

    it("compares a recipient's If-Match against the note", async () => {
      await share("alice", "edit");
      expect(
        await storage.notes.update("n1", "alice", { pinned: true }, T3, T1),
      ).toBeNull();
      expect((await storage.notes.getById("n1", "alice"))?.pinned).toBe(false);
    });

    it("lets a viewer keep personal fields but not touch the note", async () => {
      await share("alice", "view");

      await expect(
        storage.notes.update(
          "n1",
          "alice",
          claimedUpdate({ content: "hijacked" }),
          T3,
        ),
      ).rejects.toBeInstanceOf(NoteAccessError);
      // Nothing half written: not the content, and not the pin sent with it.
      await expect(
        storage.notes.update(
          "n1",
          "alice",
          claimedUpdate({ pinned: true, title: "x" }),
          T3,
        ),
      ).rejects.toBeInstanceOf(NoteAccessError);
      const after = await storage.notes.getById("n1", "alice");
      expect(after && opened(after)).toMatchObject({
        content: "- [ ] Milk",
        title: "Groceries",
        pinned: false,
        updatedAt: T0,
      });

      expect(
        await storage.notes.update("n1", "alice", { archived: true }, T3),
      ).toMatchObject({ archived: true });
    });

    it("gives a recipient a trash of their own, even as a viewer", async () => {
      await share("alice", "view");
      await share("bob", "edit");

      const trashed = await storage.notes.update(
        "n1",
        "alice",
        { trashed: true, trashedAt: T3 },
        T3,
      );
      expect(trashed).toMatchObject({ trashed: true, trashedAt: T3 });
      // Still hers, in her trash, and it does not concern other persons.
      expect(
        (await storage.notes.listByUser("alice", PAGE)).notes[0],
      ).toMatchObject({ id: "n1", trashed: true });
      expect(await storage.notes.getById("n1", "owner")).toMatchObject({
        trashed: false,
        trashedAt: null,
      });
      expect(await storage.notes.getById("n1", "bob")).toMatchObject({
        trashed: false,
      });
      expect((await storage.shares.audience("n1"))?.trashed).toBe(false);

      expect(
        await storage.notes.update(
          "n1",
          "alice",
          { trashed: false, trashedAt: null },
          T3,
        ),
      ).toMatchObject({ trashed: false, trashedAt: null });
    });

    it("leaves what only the owner decides to the owner", async () => {
      await share("alice", "edit");
      await expect(
        storage.notes.update("n1", "alice", { readonly: true }, T3),
      ).rejects.toBeInstanceOf(NoteAccessError);
      expect(await storage.notes.delete("n1", "alice")).toBe(false);
      expect(await storage.notes.getById("n1", "owner")).not.toBeNull();
    });
  });
}
