import {
  NoteColor,
  type NoteCreate,
  NoteFont,
  type SealedNote,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ciphertext,
  claimed,
  claimedUpdate,
  opened,
} from "./contracts/claimed.ts";
import { createPostgresStorage } from "./postgres/driver.ts";
import { newTestPool } from "./postgres/testDb.ts";
import { createSqliteStorage } from "./sqlite/driver.ts";
import type { StorageDriver } from "./types.ts";

/**
 * The two drivers store a note in different column types (SQLite has no boolean
 * and no JSON). Before, each one had its own copy of the mapping between a row
 * and a note. Parity was only a convention, and the tests only checked each
 * driver against itself. Thus, nobody would have seen a change made in one file
 * and not in the other.
 *
 * These tests run the same assertions against both drivers, and compare their
 * answers directly where the answer must be the same.
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

/**
 * All fields of a note. Thus, nothing passes the round trip because it stayed
 * at zero.
 */
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
    // What only the sealed note has: its key, and the excerpt with the text.
    expect(note).toMatchObject({
      key: ciphertext("key of claimed"),
      keyVersion: 1,
      excerpt: ciphertext("Milk, eggs"),
    });
  });

  it("sends nothing readable where a ciphertext belongs", async () => {
    // The color and the tags of a share start as the defaults of the columns.
    // These are not ciphertext, and mean "never set". They go out empty, never
    // as they are.
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
    // `readonly` and `source` are optional on `Note`. Each driver had its own
    // condition to decide whether to attach them. That was the only place where
    // the two mappings could disagree about the *shape* of a note, not its
    // values.
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
  /** The note that each driver returns for the same write. */
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

  /** `count` notes, each one millisecond newer than the previous one. */
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
    // The order key is `(updated_at, id)` for exactly this reason. Five notes
    // written in the same millisecond have no order by timestamp alone. A page
    // boundary among them would repeat one note and lose a different one.
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
