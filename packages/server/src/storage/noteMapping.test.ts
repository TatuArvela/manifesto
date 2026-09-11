import {
  type Note,
  NoteColor,
  type NoteCreate,
  NoteFont,
} from "@manifesto/shared";
import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPostgresStorage } from "./postgres/driver.js";
import { createSqliteStorage } from "./sqlite/driver.js";
import type { StorageDriver } from "./types.js";

/**
 * The two drivers store a note in different column types — SQLite has no
 * boolean and no JSON — and used to carry their own copy of the mapping
 * between a row and a `Note`. Parity was a convention, and the tests only ever
 * checked each driver against itself, so a change made in one file and not the
 * other would have gone unnoticed.
 *
 * These run the same assertions against both, and compare their answers
 * directly where the answer should be identical.
 */

const NOW = "2026-04-01T00:00:00.000Z";

async function openSqlite(): Promise<StorageDriver> {
  return createSqliteStorage({ dbPath: ":memory:" });
}

async function openPostgres(): Promise<StorageDriver> {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  return createPostgresStorage(
    { connectionString: "postgres://test" },
    // biome-ignore lint/suspicious/noExplicitAny: pg-mem's Pool is structurally compatible
    { poolFactory: () => new Pool() as any },
  );
}

const drivers = [
  { name: "sqlite", open: openSqlite },
  { name: "postgres", open: openPostgres },
] as const;

async function withUser(storage: StorageDriver): Promise<StorageDriver> {
  await storage.users.create({
    id: "u1",
    username: "alice",
    passwordHash: "h",
    displayName: "Alice",
    avatarColor: "#abc",
    provider: "local",
    externalId: null,
    createdAt: NOW,
  });
  return storage;
}

/** Every field a note has, so nothing round-trips by being left at zero. */
const fullNote: NoteCreate = {
  title: "Shopping",
  content: "Milk, eggs",
  color: NoteColor.Yellow,
  font: NoteFont.PermanentMarker,
  pinned: true,
  archived: false,
  trashed: true,
  trashedAt: "2026-04-02T00:00:00.000Z",
  position: 7,
  tags: ["home", "food"],
  images: ["data:image/png;base64,iVBORw0KGgo="],
  linkPreviews: [
    { url: "https://example.com", title: "Example", domain: "example.com" },
  ],
  reminder: {
    time: "2026-04-10T08:00:00",
    recurrence: "weekly" as const,
    timezone: "Europe/Helsinki",
  },
  readonly: true,
  source: { kind: "auto-note" as const, pluginId: "p1", noteKey: "" },
};

describe.each(drivers)("$name notes mapping", ({ open }) => {
  let storage: StorageDriver;

  beforeEach(async () => {
    storage = await withUser(await open());
  });

  afterEach(async () => {
    await storage.close();
  });

  it("round-trips every field of a note", async () => {
    const note = await storage.notes.insert({
      id: "n1",
      userId: "u1",
      data: fullNote,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(note).toEqual({
      id: "n1",
      ...fullNote,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("leaves the two optional fields off a note that has neither", async () => {
    // `readonly` and `source` are optional on `Note`, and each driver had its
    // own conditional deciding whether to attach them — the one place the two
    // mappings could disagree about a note's *shape* rather than its values.
    const { readonly: _r, source: _s, ...plain } = fullNote;
    const note = await storage.notes.insert({
      id: "n1",
      userId: "u1",
      data: plain,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(note).toEqual({
      id: "n1",
      ...plain,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect("readonly" in note).toBe(false);
    expect("source" in note).toBe(false);
  });

  it("folds case beyond ASCII when searching", async () => {
    // SQLite's own LOWER() folds ASCII only, so this used to find the note on
    // Postgres and not on SQLite — the same query, the same data, two answers.
    await storage.notes.insert({
      id: "n1",
      userId: "u1",
      data: { ...fullNote, title: "ÄITI JA ÖLJY", content: "Ostoslista" },
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect((await storage.notes.search("u1", "äiti")).map((n) => n.id)).toEqual(
      ["n1"],
    );
    expect((await storage.notes.search("u1", "ÖLJY")).map((n) => n.id)).toEqual(
      ["n1"],
    );
  });

  it("updates only the fields it was given", async () => {
    await storage.notes.insert({
      id: "n1",
      userId: "u1",
      data: fullNote,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const later = "2026-04-03T00:00:00.000Z";
    const updated = await storage.notes.update(
      "n1",
      "u1",
      { pinned: false, tags: ["work"] },
      later,
    );
    expect(updated).toEqual({
      id: "n1",
      ...fullNote,
      pinned: false,
      tags: ["work"],
      createdAt: NOW,
      updatedAt: later,
    });
  });
});

describe("the two drivers agree", () => {
  /** The note each driver returns for the same write. */
  async function noteFrom(open: () => Promise<StorageDriver>): Promise<Note> {
    const storage = await withUser(await open());
    try {
      await storage.notes.insert({
        id: "n1",
        userId: "u1",
        data: fullNote,
        createdAt: NOW,
        updatedAt: NOW,
      });
      const note = await storage.notes.update(
        "n1",
        "u1",
        { archived: true, reminder: null, position: 3 },
        "2026-04-03T00:00:00.000Z",
      );
      if (!note) throw new Error("update returned nothing");
      return note;
    } finally {
      await storage.close();
    }
  }

  it("returns the same note for the same writes", async () => {
    expect(await noteFrom(openSqlite)).toEqual(await noteFrom(openPostgres));
  });
});
