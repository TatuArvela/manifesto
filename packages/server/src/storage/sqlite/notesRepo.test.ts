import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claimed, claimedUpdate, opened } from "#/storage/contracts/claimed.ts";
import type { NotesRepo } from "#/storage/types.ts";
import { openDatabase, type SqliteDB } from "./database.ts";
import { createSqliteNotesRepo } from "./notesRepo.ts";
import { createSqliteUsersRepo } from "./usersRepo.ts";

/** A page large enough that these fixtures never split across two. */
const PAGE = { limit: 50 };

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
      data: claimed({ ...baseNoteData, title: "Hello" }),
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(opened(note).title).toBe("Hello");
    expect(opened(note).color).toBe(NoteColor.Yellow);
    expect(opened(note).tags).toEqual(["a"]);
    expect(await repo.getById("n1", "u1")).toMatchObject({ id: "n1" });
  });

  it("isolates notes by user id", async () => {
    await repo.insert({
      id: "n-u1",
      userId: "u1",
      data: claimed(baseNoteData),
      createdAt: NOW,
      updatedAt: NOW,
    });
    await repo.insert({
      id: "n-u2",
      userId: "u2",
      data: claimed(baseNoteData),
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(await repo.getById("n-u1", "u2")).toBeNull();
    expect((await repo.listByUser("u1", PAGE)).notes.map((n) => n.id)).toEqual([
      "n-u1",
    ]);
    expect((await repo.listByUser("u2", PAGE)).notes.map((n) => n.id)).toEqual([
      "n-u2",
    ]);
  });

  it("updates a partial set of fields and bumps updatedAt", async () => {
    await repo.insert({
      id: "n1",
      userId: "u1",
      data: claimed(baseNoteData),
      createdAt: NOW,
      updatedAt: NOW,
    });
    const updated = await repo.update(
      "n1",
      "u1",
      claimedUpdate({ title: "Renamed", pinned: true }),
      "2026-04-02T00:00:00.000Z",
    );
    expect(updated && opened(updated).title).toBe("Renamed");
    expect(updated?.pinned).toBe(true);
    expect(updated && opened(updated).content).toBe("Body");
    expect(updated?.updatedAt).toBe("2026-04-02T00:00:00.000Z");
    expect(updated?.createdAt).toBe(NOW);
  });

  it("returns null when updating a note that doesn't belong to the user", async () => {
    await repo.insert({
      id: "n1",
      userId: "u1",
      data: claimed(baseNoteData),
      createdAt: NOW,
      updatedAt: NOW,
    });
    const result = await repo.update(
      "n1",
      "u2",
      claimedUpdate({ title: "x" }),
      "2026-04-02T00:00:00.000Z",
    );
    expect(result).toBeNull();
    const original = await repo.getById("n1", "u1");
    expect(original && opened(original).title).toBe("Title");
  });

  it("deletes notes, scoped to the owning user", async () => {
    await repo.insert({
      id: "n1",
      userId: "u1",
      data: claimed(baseNoteData),
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(await repo.delete("n1", "u2")).toBe(false);
    expect(await repo.delete("n1", "u1")).toBe(true);
    expect(await repo.getById("n1", "u1")).toBeNull();
  });

  it("preserves null reminder on round-trip", async () => {
    const note = await repo.insert({
      id: "n1",
      userId: "u1",
      data: claimed(baseNoteData),
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(note.reminder).toBeNull();
  });

  it("round-trips a structured reminder", async () => {
    const note = await repo.insert({
      id: "n1",
      userId: "u1",
      data: claimed({
        ...baseNoteData,
        reminder: {
          time: "2026-04-10T08:00:00",
          recurrence: "weekly",
          timezone: "Europe/Helsinki",
        },
      }),
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
