import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSqliteStorage } from "../storage/sqlite/driver.js";
import { backupName, takeBackup } from "./scheduledBackup.js";

describe("scheduled backups", () => {
  it("writes a readable copy and keeps only the newest", async () => {
    const root = await mkdtemp(join(tmpdir(), "manifesto-backup-"));
    const storage = createSqliteStorage({ dbPath: join(root, "manifesto.db") });
    await storage.users.create({
      id: "u1",
      username: "alice",
      displayName: "",
      avatarColor: "",
      provider: "local",
      externalId: null,
      passwordHash: "h",
      createdAt: new Date().toISOString(),
    });
    const dir = join(root, "backups");
    for (let hour = 0; hour < 4; hour++) {
      await takeBackup(
        storage,
        { dir, keep: 2 },
        new Date(Date.UTC(2026, 8, 23, hour)),
      );
    }
    const files = (await readdir(dir)).sort();
    expect(files).toEqual([
      "manifesto-20260923-020000.db",
      "manifesto-20260923-030000.db",
    ]);
    const copy = new Database(join(dir, files[1]), { readonly: true });
    expect(
      (copy.prepare("SELECT username FROM users").get() as { username: string })
        .username,
    ).toBe("alice");
    copy.close();
    await storage.close();
  });

  it("names backups so they sort by time", () => {
    expect(backupName(new Date("2026-09-23T10:15:00.000Z"))).toBe(
      "manifesto-20260923-101500.db",
    );
  });
});
