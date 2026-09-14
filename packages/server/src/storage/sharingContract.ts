import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CreateUserInput,
  EmailTakenError,
  NoteAccessError,
  type StorageDriver,
} from "./types.js";

/**
 * What both drivers must do for sharing notes between accounts, run against
 * each, for the same reason `adminContract.ts` exists: these are rules about
 * who sees what, and a driver that gets one wrong should fail under its own
 * name rather than in whichever route happens to notice.
 */

const T0 = "2026-04-01T00:00:00.000Z";
const T1 = "2026-04-01T00:00:01.000Z";
const T2 = "2026-04-01T00:00:02.000Z";
const T3 = "2026-04-01T00:00:03.000Z";
const PAGE = { limit: 50 };

function userInput(
  id: string,
  username: string,
  overrides: Partial<CreateUserInput> = {},
): CreateUserInput {
  return {
    id,
    username,
    passwordHash: "h",
    displayName: "",
    avatarColor: "#123456",
    provider: "local",
    externalId: null,
    createdAt: T0,
    ...overrides,
  };
}

const noteData = {
  title: "Groceries",
  content: "- [ ] Milk",
  color: NoteColor.Yellow,
  font: NoteFont.Default,
  pinned: true,
  archived: false,
  trashed: false,
  trashedAt: null,
  position: 5,
  tags: ["home"],
  images: [],
  linkPreviews: [],
  reminder: null,
};

export function describeSharingContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: sharing`, () => {
    let storage: StorageDriver;

    beforeEach(async () => {
      storage = await boot();
      await storage.users.create(
        userInput("owner", "olivia", { displayName: "Olivia" }),
      );
      await storage.users.create(userInput("alice", "alice"));
      await storage.users.create(userInput("bob", "bob"));
      await storage.notes.insert({
        id: "n1",
        userId: "owner",
        data: noteData,
        createdAt: T0,
        updatedAt: T0,
      });
    });

    afterEach(async () => {
      await storage.close();
    });

    async function share(userId: string, role: "edit" | "view", accept = true) {
      expect(
        await storage.shares.create({
          noteId: "n1",
          userId,
          role,
          createdAt: T1,
        }),
      ).toBe("ok");
      if (accept) {
        expect(await storage.shares.accept("n1", userId, T2)).toBe(true);
      }
    }

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
          title: "Groceries",
          content: "- [ ] Milk",
          color: NoteColor.Yellow,
          font: NoteFont.Default,
          invitedAt: T1,
        },
      ]);
      expect(await storage.shares.getInvitation("n1", "alice")).toMatchObject({
        noteId: "n1",
      });
      expect(await storage.shares.getInvitation("n1", "bob")).toBeNull();
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
      expect(seen).toMatchObject({
        title: "Groceries",
        color: NoteColor.Yellow,
        pinned: false,
        archived: false,
        tags: [],
        reminder: null,
        position: Date.parse(T2),
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
      // Accepting twice is not a thing.
      expect(await storage.shares.accept("n1", "alice", T3)).toBe(false);
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
      // A note nobody was invited to carries no `sharing` at all.
      await storage.notes.insert({
        id: "n2",
        userId: "owner",
        data: noteData,
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
        {
          tags: ["errands"],
          pinned: true,
          color: NoteColor.Blue,
          title: "Shopping",
        },
        T3,
        T0,
      );
      expect(alices).toMatchObject({
        title: "Shopping",
        tags: ["errands"],
        pinned: true,
        color: NoteColor.Blue,
        updatedAt: T3,
      });

      const owners = await storage.notes.getById("n1", "owner");
      expect(owners).toMatchObject({
        title: "Shopping",
        tags: ["home"],
        pinned: true,
        color: NoteColor.Yellow,
        position: 5,
        // One concurrency token for everyone.
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
        storage.notes.update("n1", "alice", { content: "hijacked" }, T3),
      ).rejects.toBeInstanceOf(NoteAccessError);
      // Nothing half-written: not the content, not the pin sent with it.
      await expect(
        storage.notes.update("n1", "alice", { pinned: true, title: "x" }, T3),
      ).rejects.toBeInstanceOf(NoteAccessError);
      const after = await storage.notes.getById("n1", "alice");
      expect(after).toMatchObject({
        content: "- [ ] Milk",
        title: "Groceries",
        pinned: false,
        updatedAt: T0,
      });

      expect(
        await storage.notes.update("n1", "alice", { archived: true }, T3),
      ).toMatchObject({ archived: true });
    });

    it("leaves the trash to the owner", async () => {
      await share("alice", "edit");
      await expect(
        storage.notes.update("n1", "alice", { trashed: true }, T3),
      ).rejects.toBeInstanceOf(NoteAccessError);
      expect(await storage.notes.delete("n1", "alice")).toBe(false);
      expect(await storage.notes.getById("n1", "owner")).not.toBeNull();
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
      expect(await storage.shares.accept("n1", "bob", T3)).toBe(false);
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
          data: noteData,
          createdAt: at,
          updatedAt: at,
        });
      }
      await storage.notes.update(
        "n1",
        "owner",
        { title: "Later" },
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

    it("searches the notes shared with a user too", async () => {
      await share("alice", "view");
      expect(
        (await storage.notes.search("alice", "milk", PAGE)).notes.map(
          (n) => n.id,
        ),
      ).toEqual(["n1"]);
      expect((await storage.notes.search("bob", "milk", PAGE)).notes).toEqual(
        [],
      );
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
          },
          {
            noteId: "n1",
            userId: "bob",
            role: "view",
            createdAt: T1,
            acceptedAt: null,
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
