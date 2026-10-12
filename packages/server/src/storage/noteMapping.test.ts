import {
  NoteColor,
  type NoteCreate,
  NoteFont,
  type SealedNote,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claimed, claimedUpdate, ct, opened } from "./contracts/claimed.js";
import { createPostgresStorage } from "./postgres/driver.js";
import { newTestPool } from "./postgres/testDb.js";
import { createSqliteStorage } from "./sqlite/driver.js";
import type { StorageDriver } from "./types.js";

/**
 * The two drivers store a note in different column types (SQLite has no
 * boolean and no JSON) and used to carry their own copy of the mapping
 * between a row and a note. Parity was a convention, and the tests only ever
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
  return createPostgresStorage(
    { connectionString: "postgres://test" },
    { poolFactory: newTestPool },
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
  images: ["attachment:01J8Z3Q4R5S6T7V8W9X0Y1Z2AB"],
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
      data: claimed(fullNote),
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(opened(note)).toEqual({
      id: "n1",
      ...fullNote,
      createdAt: NOW,
      updatedAt: NOW,
    });
    // What only the sealed note has: its key, and the excerpt beside the text.
    expect(note).toMatchObject({
      key: ct("key of claimed"),
      keyVersion: 1,
      excerpt: ct("Milk, eggs"),
    });
  });

  it("sends nothing readable where a ciphertext belongs", async () => {
    // A share's colour and tags start as the columns' defaults, which are not
    // ciphertext and mean "never set": they go out empty, never as they are.
    const note = await storage.notes.insert({
      id: "n1",
      userId: "u1",
      data: { ...claimed(fullNote), title: "readable", tags: "[]" },
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(note.title).toBe("");
    expect(note.tags).toBe("");
  });

  it("leaves the two optional fields off a note that has neither", async () => {
    // `readonly` and `source` are optional on `Note`, and each driver had its
    // own conditional deciding whether to attach them, the one place the two
    // mappings could disagree about a note's *shape* rather than its values.
    const { readonly: _r, source: _s, ...plain } = fullNote;
    const note = await storage.notes.insert({
      id: "n1",
      userId: "u1",
      data: claimed(plain),
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(opened(note)).toEqual({
      id: "n1",
      ...plain,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect("readonly" in note).toBe(false);
    expect("source" in note).toBe(false);
  });

  it("updates only the fields it was given", async () => {
    await storage.notes.insert({
      id: "n1",
      userId: "u1",
      data: claimed(fullNote),
      createdAt: NOW,
      updatedAt: NOW,
    });
    const later = "2026-04-03T00:00:00.000Z";
    const updated = await storage.notes.update(
      "n1",
      "u1",
      claimedUpdate({ pinned: false, tags: ["work"] }),
      later,
    );
    expect(updated && opened(updated)).toEqual({
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
  async function noteFrom(
    open: () => Promise<StorageDriver>,
  ): Promise<SealedNote> {
    const storage = await withUser(await open());
    try {
      await storage.notes.insert({
        id: "n1",
        userId: "u1",
        data: claimed(fullNote),
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

describe.each(drivers)("$name listings", ({ open }) => {
  let storage: StorageDriver;

  beforeEach(async () => {
    storage = await withUser(await open());
  });

  afterEach(async () => {
    await storage.close();
  });

  /** `count` notes, each a millisecond newer than the last. */
  async function seed(count: number, extra: Partial<typeof fullNote> = {}) {
    for (let i = 0; i < count; i++) {
      const at = new Date(Date.parse(NOW) + i).toISOString();
      await storage.notes.insert({
        id: `n${String(i).padStart(2, "0")}`,
        userId: "u1",
        data: claimed({ ...fullNote, title: `Note ${i}`, ...extra }),
        createdAt: at,
        updatedAt: at,
      });
    }
  }

  it("returns a page and a cursor that reaches the next one", async () => {
    await seed(5);

    const first = await storage.notes.listByUser("u1", { limit: 2 });
    expect(first.notes.map((n) => n.id)).toEqual(["n04", "n03"]);
    expect(first.nextCursor).toBeTruthy();

    const second = await storage.notes.listByUser("u1", {
      limit: 2,
      cursor: first.nextCursor as string,
    });
    expect(second.notes.map((n) => n.id)).toEqual(["n02", "n01"]);

    const third = await storage.notes.listByUser("u1", {
      limit: 2,
      cursor: second.nextCursor as string,
    });
    expect(third.notes.map((n) => n.id)).toEqual(["n00"]);
    expect(third.nextCursor).toBeNull();
  });

  it("walks every note exactly once, even when they share a timestamp", async () => {
    // The ordering key is `(updated_at, id)` for exactly this: five notes
    // written in the same millisecond have no order by timestamp alone, and a
    // page boundary inside them would repeat one and drop another.
    for (let i = 0; i < 5; i++) {
      await storage.notes.insert({
        id: `same-${i}`,
        userId: "u1",
        data: claimed({ ...fullNote, title: `Note ${i}` }),
        createdAt: NOW,
        updatedAt: NOW,
      });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { notes: { id: string }[]; nextCursor: string | null } =
        await storage.notes.listByUser("u1", {
          limit: 2,
          ...(cursor ? { cursor } : {}),
        });
      seen.push(...page.notes.map((n) => n.id));
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it("lists a note's sealed images, and never the references the server keeps", async () => {
    await seed(1);
    const { notes: listed } = await storage.notes.listByUser("u1", {
      limit: 10,
    });
    const [first] = listed;
    expect(first && opened(first).images).toEqual(fullNote.images);
    expect(first && "imageRefs" in first).toBe(false);
    expect(first && "previewRefs" in first).toBe(false);
  });
});
