import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreateUserInput, StorageDriver } from "./types.js";

/**
 * What both drivers must do for account administration, run against each.
 *
 * Shared rather than copied because these are rules, not queries: the first
 * account is the admin, the last admin stays, a deleted user takes their notes
 * and sessions along. A driver that gets one of them wrong fails here under its
 * own name.
 */

const NOW = "2026-04-01T00:00:00.000Z";

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
    avatarColor: "",
    provider: "local",
    externalId: null,
    createdAt: NOW,
    ...overrides,
  };
}

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

export function describeAdminContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: account administration`, () => {
    let storage: StorageDriver;

    beforeEach(async () => {
      storage = await boot();
    });

    afterEach(async () => {
      await storage.close();
    });

    async function addNote(id: string, userId: string) {
      await storage.notes.insert({
        id,
        userId,
        data: noteData,
        createdAt: NOW,
        updatedAt: NOW,
      });
    }

    async function addSession(token: string, userId: string, seen: string) {
      await storage.sessions.create({
        token,
        userId,
        createdAt: NOW,
        expiresAt: "2026-05-01T00:00:00.000Z",
        lastSeenAt: seen,
      });
    }

    it("makes the first account an admin and no later one", async () => {
      const first = await storage.users.create(userInput("u1", "alice"));
      const second = await storage.users.create(userInput("u2", "bob"));
      expect(first.isAdmin).toBe(true);
      expect(second.isAdmin).toBe(false);
    });

    it("makes an account an admin when asked, first or not", async () => {
      await storage.users.create(userInput("u1", "alice"));
      const asked = await storage.users.create(
        userInput("u2", "bob", {
          isAdmin: true,
          createdAt: "2026-03-01T00:00:00.000Z",
        }),
      );
      const notAsked = await storage.users.create(userInput("u3", "carol"));
      expect(asked.isAdmin).toBe(true);
      expect(notAsked.isAdmin).toBe(false);
      // Oldest first.
      expect((await storage.users.listAdmins()).map((u) => u.id)).toEqual([
        "u2",
        "u1",
      ]);
    });

    it("stores whether a password is a temporary one", async () => {
      await storage.users.create(userInput("u1", "alice"));
      const created = await storage.users.create(
        userInput("u2", "bob", { mustChangePassword: true }),
      );
      expect(created.mustChangePassword).toBe(true);

      expect(await storage.users.setPassword("u2", "h2", false)).toBe(true);
      const after = await storage.users.findById("u2");
      expect(after).toMatchObject({
        passwordHash: "h2",
        mustChangePassword: false,
      });
      expect(await storage.users.setPassword("nope", "h", false)).toBe(false);
    });

    it("lists users by username with their note count and latest activity", async () => {
      await storage.users.create(userInput("u1", "carol"));
      await storage.users.create(userInput("u2", "Alice"));
      await storage.users.create(userInput("u3", "bob"));
      await addNote("n1", "u2");
      await addNote("n2", "u2");
      await addNote("n3", "u1");
      await addSession("s1", "u2", "2026-04-02T00:00:00.000Z");
      await addSession("s2", "u2", "2026-04-03T00:00:00.000Z");

      const users = await storage.users.list();
      expect(
        users.map(({ username, noteCount, lastSeenAt }) => ({
          username,
          noteCount,
          lastSeenAt,
        })),
      ).toEqual([
        {
          username: "Alice",
          noteCount: 2,
          lastSeenAt: "2026-04-03T00:00:00.000Z",
        },
        { username: "bob", noteCount: 0, lastSeenAt: null },
        { username: "carol", noteCount: 1, lastSeenAt: null },
      ]);
      expect(await storage.users.summarize("u2")).toMatchObject({
        username: "Alice",
        noteCount: 2,
      });
      expect(await storage.users.summarize("nope")).toBeNull();
    });

    it("grants and revokes admin, but never from the last admin", async () => {
      await storage.users.create(userInput("u1", "alice"));
      await storage.users.create(userInput("u2", "bob"));

      expect(await storage.users.setAdmin("u1", false)).toBe("last-admin");
      expect((await storage.users.findById("u1"))?.isAdmin).toBe(true);

      expect(await storage.users.setAdmin("u2", true)).toBe("ok");
      expect(await storage.users.setAdmin("u1", false)).toBe("ok");
      expect((await storage.users.findById("u1"))?.isAdmin).toBe(false);
      expect(await storage.users.setAdmin("u2", false)).toBe("last-admin");

      expect(await storage.users.setAdmin("nope", true)).toBe("not-found");
    });

    it("deletes a user with their notes and sessions", async () => {
      await storage.users.create(userInput("u1", "alice"));
      await storage.users.create(userInput("u2", "bob"));
      await addNote("n1", "u2");
      await addSession("s1", "u2", NOW);

      expect(await storage.users.delete("u2")).toBe("ok");
      expect(await storage.users.findById("u2")).toBeNull();
      expect(await storage.notes.getById("n1", "u2")).toBeNull();
      expect(await storage.sessions.findByToken("s1")).toBeNull();
      expect(await storage.users.delete("u2")).toBe("not-found");
    });

    it("refuses to delete the last admin", async () => {
      await storage.users.create(userInput("u1", "alice"));
      expect(await storage.users.delete("u1")).toBe("last-admin");
      expect(await storage.users.findById("u1")).not.toBeNull();
    });

    it("ends every session of a user, optionally sparing one", async () => {
      await storage.users.create(userInput("u1", "alice"));
      await storage.users.create(userInput("u2", "bob"));
      await addSession("a1", "u1", NOW);
      await addSession("a2", "u1", NOW);
      await addSession("a3", "u1", NOW);
      await addSession("b1", "u2", NOW);

      expect(await storage.sessions.deleteByUser("u1", "a2")).toBe(2);
      expect(await storage.sessions.findByToken("a1")).toBeNull();
      expect(await storage.sessions.findByToken("a2")).not.toBeNull();
      expect(await storage.sessions.findByToken("b1")).not.toBeNull();

      expect(await storage.sessions.deleteByUser("u1")).toBe(1);
      expect(await storage.sessions.findByToken("a2")).toBeNull();
    });
  });
}
