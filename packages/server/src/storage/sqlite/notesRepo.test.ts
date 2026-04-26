import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NotesRepo } from "../types.js";
import { openDatabase, type SqliteDB } from "./database.js";
import { createSqliteNotesRepo } from "./notesRepo.js";
import { createSqliteUsersRepo } from "./usersRepo.js";

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

describe("sqlite notesRepo", () => {
  let db: SqliteDB;
  let repo: NotesRepo;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    const users = createSqliteUsersRepo(db);
    await users.create({
      id: "u1",
      username: "alice",
      passwordHash: "h",
      displayName: "",
      avatarColor: "",
      provider: "local",
      externalId: null,
      createdAt: NOW,
    });
    await users.create({
      id: "u2",
      username: "bob",
      passwordHash: "h",
      displayName: "",
      avatarColor: "",
      provider: "local",
      externalId: null,
      createdAt: NOW,
    });
    repo = createSqliteNotesRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it("inserts and retrieves a note for the owning user", async () => {
    const note = await repo.insert({
      id: "n1",
      userId: "u1",
      data: { ...baseNoteData, title: "Hello" },
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(note.title).toBe("Hello");
    expect(note.color).toBe(NoteColor.Yellow);
    expect(note.tags).toEqual(["a"]);
    expect(await repo.getById("n1", "u1")).toMatchObject({ id: "n1" });
  });

  it("isolates notes by user id", async () => {
    await repo.insert({
      id: "n-u1",
      userId: "u1",
      data: baseNoteData,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await repo.insert({
      id: "n-u2",
      userId: "u2",
      data: baseNoteData,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(await repo.getById("n-u1", "u2")).toBeNull();
    expect((await repo.listByUser("u1")).map((n) => n.id)).toEqual(["n-u1"]);
    expect((await repo.listByUser("u2")).map((n) => n.id)).toEqual(["n-u2"]);
  });

  it("updates a partial set of fields and bumps updatedAt", async () => {
    await repo.insert({
      id: "n1",
      userId: "u1",
      data: baseNoteData,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const updated = await repo.update(
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

  it("returns null when updating a note that doesn't belong to the user", async () => {
    await repo.insert({
      id: "n1",
      userId: "u1",
      data: baseNoteData,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const result = await repo.update(
      "n1",
      "u2",
      { title: "x" },
      "2026-04-02T00:00:00.000Z",
    );
    expect(result).toBeNull();
    const original = await repo.getById("n1", "u1");
    expect(original?.title).toBe("Title");
  });

  it("deletes notes, scoped to the owning user", async () => {
    await repo.insert({
      id: "n1",
      userId: "u1",
      data: baseNoteData,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(await repo.delete("n1", "u2")).toBe(false);
    expect(await repo.delete("n1", "u1")).toBe(true);
    expect(await repo.getById("n1", "u1")).toBeNull();
  });

  it("searches by case-insensitive substring on title and content", async () => {
    await repo.insert({
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
    await repo.insert({
      id: "n2",
      userId: "u1",
      data: { ...baseNoteData, title: "Trip notes", content: "fly to LAX" },
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect((await repo.search("u1", "EGGS")).map((n) => n.id)).toEqual(["n1"]);
    expect((await repo.search("u1", "trip")).map((n) => n.id)).toEqual(["n2"]);
    expect(await repo.search("u2", "trip")).toEqual([]);
  });

  it("preserves null reminder on round-trip", async () => {
    const note = await repo.insert({
      id: "n1",
      userId: "u1",
      data: baseNoteData,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(note.reminder).toBeNull();
  });

  it("round-trips a structured reminder", async () => {
    const note = await repo.insert({
      id: "n1",
      userId: "u1",
      data: {
        ...baseNoteData,
        reminder: {
          time: "2026-04-10T08:00:00",
          recurrence: "weekly",
          timezone: "Europe/Helsinki",
        },
      },
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(note.reminder).toEqual({
      time: "2026-04-10T08:00:00",
      recurrence: "weekly",
      timezone: "Europe/Helsinki",
    });
  });
});
