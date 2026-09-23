import { describe, expect, it } from "vitest";
import { describeSearchContract } from "../searchContract.js";
import { createSqliteStorage, type SqliteStorageDriver } from "./driver.js";

describeSearchContract(
  "sqlite",
  async () => createSqliteStorage({ dbPath: ":memory:" }),
  async (storage) => {
    const { db } = storage as SqliteStorageDriver;
    db.exec(`DELETE FROM note_terms; UPDATE notes SET search_version = 0`);
  },
);

describe("sqlite: search index backfill", () => {
  it("indexes stale notes when the database is opened again", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dbPath = join(mkdtempSync(join(tmpdir(), "manifesto-")), "db.sqlite");
    const first = createSqliteStorage({ dbPath });
    await first.users.create({
      id: "u1",
      username: "una",
      passwordHash: "h",
      displayName: "",
      avatarColor: "",
      provider: "local",
      externalId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await first.db
      .prepare(
        `INSERT INTO notes (id, user_id, title, content, color, font, created_at, updated_at)
       VALUES ('n1', 'u1', 'Old note', 'from before', 'default', 'default',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run();
    expect(
      (await first.notes.search("u1", "before", { limit: 5 })).notes,
    ).toEqual([]);
    await first.close();

    const second = createSqliteStorage({ dbPath });
    const found = await second.notes.search("u1", "before", { limit: 5 });
    expect(found.notes.map((n) => n.id)).toEqual(["n1"]);
    await second.close();
  });
});
