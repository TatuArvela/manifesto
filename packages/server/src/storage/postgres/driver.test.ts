import { NoteColor, NoteFont } from "@manifesto/shared";
import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPostgresStorage, type PostgresStorageDriver } from "./driver.js";

async function bootStorage(): Promise<PostgresStorageDriver> {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  return createPostgresStorage(
    { connectionString: "postgres://test" },
    {
      // biome-ignore lint/suspicious/noExplicitAny: pg-mem returns a constructor that's structurally compatible with pg.Pool
      poolFactory: () => new Pool() as any,
    },
  );
}

const NOW = "2026-04-01T00:00:00.000Z";

const baseNoteData = {
  title: "Title",
  content: "Body",
  color: NoteColor.Yellow,
  font: NoteFont.Default,
  pinned: false,
  archived: false,
  trashed: false,
  trashedAt: null,
  position: 0,
  tags: ["a"],
  images: [],
  linkPreviews: [],
  reminder: null,
};

describe("postgres storage driver (pg-mem)", () => {
  let storage: PostgresStorageDriver;

  beforeEach(async () => {
    storage = await bootStorage();
  });

  afterEach(async () => {
    await storage.close();
  });

  describe("usersRepo", () => {
    it("creates and retrieves users by id, username, and (provider, externalId)", async () => {
      const local = await storage.users.create({
        id: "u-local",
        username: "alice",
        passwordHash: "hashed",
        displayName: "Alice",
        avatarColor: "#abc",
        provider: "local",
        externalId: null,
        createdAt: NOW,
      });
      expect(local.username).toBe("alice");
      expect(local.passwordHash).toBe("hashed");
      expect(await storage.users.findById("u-local")).toMatchObject({
        username: "alice",
      });
      expect(await storage.users.findByUsername("ALICE")).toMatchObject({
        id: "u-local",
      });

      await storage.users.create({
        id: "u-sso",
        username: "bob",
        passwordHash: null,
        displayName: "",
        avatarColor: "",
        provider: "oidc:idp",
        externalId: "sub-1",
        createdAt: NOW,
      });
      expect(
        (await storage.users.findByExternalId("oidc:idp", "sub-1"))?.id,
      ).toBe("u-sso");
    });

    it("rejects duplicate usernames at the DB layer (case-insensitive)", async () => {
      await storage.users.create({
        id: "u1",
        username: "alice",
        passwordHash: "h",
        displayName: "",
        avatarColor: "",
        provider: "local",
        externalId: null,
        createdAt: NOW,
      });
      await expect(
        storage.users.create({
          id: "u2",
          username: "ALICE",
          passwordHash: "h",
          displayName: "",
          avatarColor: "",
          provider: "local",
          externalId: null,
          createdAt: NOW,
        }),
      ).rejects.toThrow();
    });
  });

  describe("sessionsRepo", () => {
    beforeEach(async () => {
      await storage.users.create({
        id: "u1",
        username: "alice",
        passwordHash: "h",
        displayName: "",
        avatarColor: "",
        provider: "local",
        externalId: null,
        createdAt: NOW,
      });
    });

    it("creates, finds, touches, and deletes sessions", async () => {
      await storage.sessions.create({
        token: "tok",
        userId: "u1",
        createdAt: NOW,
        expiresAt: "2026-05-01T00:00:00.000Z",
        lastSeenAt: NOW,
      });
      expect(await storage.sessions.findByToken("tok")).toMatchObject({
        userId: "u1",
      });
      await storage.sessions.touch(
        "tok",
        "2026-04-05T00:00:00.000Z",
        "2026-05-05T00:00:00.000Z",
      );
      const after = await storage.sessions.findByToken("tok");
      expect(after?.expiresAt).toBe("2026-05-05T00:00:00.000Z");

      await storage.sessions.deleteByToken("tok");
      expect(await storage.sessions.findByToken("tok")).toBeNull();
    });

    it("deletes only expired sessions", async () => {
      await storage.sessions.create({
        token: "old",
        userId: "u1",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-02-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
      });
      await storage.sessions.create({
        token: "fresh",
        userId: "u1",
        createdAt: NOW,
        expiresAt: "2026-05-01T00:00:00.000Z",
        lastSeenAt: NOW,
      });
      const removed = await storage.sessions.deleteExpired(
        "2026-03-01T00:00:00.000Z",
      );
      expect(removed).toBe(1);
      expect(await storage.sessions.findByToken("old")).toBeNull();
      expect(await storage.sessions.findByToken("fresh")).not.toBeNull();
    });
  });

  describe("notesRepo", () => {
    beforeEach(async () => {
      await storage.users.create({
        id: "u1",
        username: "alice",
        passwordHash: "h",
        displayName: "",
        avatarColor: "",
        provider: "local",
        externalId: null,
        createdAt: NOW,
      });
      await storage.users.create({
        id: "u2",
        username: "bob",
        passwordHash: "h",
        displayName: "",
        avatarColor: "",
        provider: "local",
        externalId: null,
        createdAt: NOW,
      });
    });

    it("inserts, retrieves, and isolates notes by user", async () => {
      await storage.notes.insert({
        id: "n1",
        userId: "u1",
        data: { ...baseNoteData, title: "Hello" },
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(await storage.notes.getById("n1", "u1")).toMatchObject({
        title: "Hello",
        tags: ["a"],
      });
      expect(await storage.notes.getById("n1", "u2")).toBeNull();
      expect((await storage.notes.listByUser("u1")).map((n) => n.id)).toEqual([
        "n1",
      ]);
    });

    it("updates a partial set of fields and bumps updatedAt", async () => {
      await storage.notes.insert({
        id: "n1",
        userId: "u1",
        data: baseNoteData,
        createdAt: NOW,
        updatedAt: NOW,
      });
      const updated = await storage.notes.update(
        "n1",
        "u1",
        { title: "Renamed", pinned: true },
        "2026-04-02T00:00:00.000Z",
      );
      expect(updated?.title).toBe("Renamed");
      expect(updated?.pinned).toBe(true);
      expect(updated?.content).toBe("Body");
      expect(updated?.updatedAt).toBe("2026-04-02T00:00:00.000Z");
      expect(updated?.createdAt).toBe(NOW);
    });

    it("update returns null when the note belongs to another user", async () => {
      await storage.notes.insert({
        id: "n1",
        userId: "u1",
        data: baseNoteData,
        createdAt: NOW,
        updatedAt: NOW,
      });
      const result = await storage.notes.update(
        "n1",
        "u2",
        { title: "x" },
        "2026-04-02T00:00:00.000Z",
      );
      expect(result).toBeNull();
    });

    it("deletes notes scoped to the owning user", async () => {
      await storage.notes.insert({
        id: "n1",
        userId: "u1",
        data: baseNoteData,
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(await storage.notes.delete("n1", "u2")).toBe(false);
      expect(await storage.notes.delete("n1", "u1")).toBe(true);
      expect(await storage.notes.getById("n1", "u1")).toBeNull();
    });

    it("searches by case-insensitive substring on title and content", async () => {
      await storage.notes.insert({
        id: "n1",
        userId: "u1",
        data: {
          ...baseNoteData,
          title: "Shopping list",
          content: "Eggs and milk",
        },
        createdAt: NOW,
        updatedAt: NOW,
      });
      await storage.notes.insert({
        id: "n2",
        userId: "u1",
        data: { ...baseNoteData, title: "Trip notes", content: "fly to LAX" },
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(
        (await storage.notes.search("u1", "EGGS")).map((n) => n.id),
      ).toEqual(["n1"]);
      expect(
        (await storage.notes.search("u1", "trip")).map((n) => n.id),
      ).toEqual(["n2"]);
      expect(await storage.notes.search("u2", "trip")).toEqual([]);
    });

    it("round-trips structured fields (reminder, tags)", async () => {
      const note = await storage.notes.insert({
        id: "n1",
        userId: "u1",
        data: {
          ...baseNoteData,
          tags: ["x", "y"],
          reminder: {
            time: "2026-04-10T08:00:00",
            recurrence: "weekly",
            timezone: "Europe/Helsinki",
          },
        },
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(note.tags).toEqual(["x", "y"]);
      expect(note.reminder).toEqual({
        time: "2026-04-10T08:00:00",
        recurrence: "weekly",
        timezone: "Europe/Helsinki",
      });
    });
  });

  describe("yjsStore", () => {
    beforeEach(async () => {
      await storage.users.create({
        id: "u1",
        username: "alice",
        passwordHash: "h",
        displayName: "",
        avatarColor: "",
        provider: "local",
        externalId: null,
        createdAt: NOW,
      });
      await storage.notes.insert({
        id: "n1",
        userId: "u1",
        data: baseNoteData,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });

    it("round-trips Yjs state bytes via bytea", async () => {
      const state = Buffer.from([1, 2, 3, 4, 5]);
      const vector = Buffer.from([9, 8, 7]);
      await storage.yjs.store("n1", "u1", state, vector, NOW);
      const loaded = await storage.yjs.load("n1", "u1");
      expect(loaded).toBeInstanceOf(Buffer);
      expect(Array.from(loaded ?? Buffer.alloc(0))).toEqual([1, 2, 3, 4, 5]);
    });

    it("returns null when the note has no persisted state yet", async () => {
      expect(await storage.yjs.load("n1", "u1")).toBeNull();
    });
  });

  describe("maintenanceRepo", () => {
    beforeEach(async () => {
      await storage.users.create({
        id: "u1",
        username: "alice",
        passwordHash: "h",
        displayName: "",
        avatarColor: "",
        provider: "local",
        externalId: null,
        createdAt: NOW,
      });
    });

    it("hard-deletes trashed notes older than the cutoff and reports them", async () => {
      const longAgo = "2025-01-01T00:00:00.000Z";
      const recent = "2026-04-20T00:00:00.000Z";
      await storage.notes.insert({
        id: "expired",
        userId: "u1",
        data: { ...baseNoteData, trashed: true, trashedAt: longAgo },
        createdAt: longAgo,
        updatedAt: longAgo,
      });
      await storage.notes.insert({
        id: "fresh",
        userId: "u1",
        data: { ...baseNoteData, trashed: true, trashedAt: recent },
        createdAt: recent,
        updatedAt: recent,
      });
      const removed = await storage.maintenance.cleanupTrashedBefore(
        "2026-04-01T00:00:00.000Z",
      );
      expect(removed).toEqual([{ id: "expired", userId: "u1" }]);
      expect(await storage.notes.getById("expired", "u1")).toBeNull();
      expect(await storage.notes.getById("fresh", "u1")).not.toBeNull();
    });

    it("returns an empty array when nothing is expired", async () => {
      const removed = await storage.maintenance.cleanupTrashedBefore(
        "2026-04-01T00:00:00.000Z",
      );
      expect(removed).toEqual([]);
    });
  });
});
