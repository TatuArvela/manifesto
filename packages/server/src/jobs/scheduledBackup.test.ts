import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSqliteStorage,
  type SqliteStorageDriver,
} from "../storage/sqlite/driver.js";
import {
  BACKUP_FREE_RESERVE_BYTES,
  type BackupEnvironment,
  backupName,
  backupTime,
  fileSystemEnvironment,
  takeBackup,
} from "./scheduledBackup.js";

const at = (hour: number) => new Date(Date.UTC(2026, 8, 23, hour));
const plenty: BackupEnvironment = {
  freeBytes: async () => 10 * 1024 ** 3,
  databaseBytes: async () => 1024 ** 2,
};

describe("scheduled backups", () => {
  let root: string;
  let dir: string;
  let storage: SqliteStorageDriver;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "manifesto-backup-"));
    dir = join(root, "backups");
    storage = createSqliteStorage({ dbPath: join(root, "manifesto.db") });
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
  });

  afterEach(async () => {
    await storage.close();
  });

  const run = (hour: number, env = plenty, keep = 2) =>
    takeBackup(storage, { dir, keep, intervalHours: 1 }, env, at(hour));

  it("writes a readable copy and keeps only the newest", async () => {
    for (let hour = 0; hour < 4; hour++) await run(hour);
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
  });

  it("skips a run soon after the last backup, as a restart would cause", async () => {
    await run(0);
    const again = await takeBackup(
      storage,
      { dir, keep: 2, intervalHours: 24 },
      plenty,
      new Date(at(0).getTime() + 60_000),
    );
    expect(again).toEqual({
      kind: "skipped",
      reason: "recent",
      latest: "manifesto-20260923-000000.db",
    });
    expect(await readdir(dir)).toHaveLength(1);
  });

  it("still runs when the timer fires a little early", async () => {
    await run(0);
    const early = new Date(at(1).getTime() - 60_000);
    const outcome = await takeBackup(
      storage,
      { dir, keep: 2, intervalHours: 1 },
      plenty,
      early,
    );
    expect(outcome.kind).toBe("taken");
  });

  it("clears what a crash left half-written", async () => {
    await run(0);
    await writeFile(join(dir, "manifesto-20260923-003000.db.partial"), "x");
    await writeFile(join(dir, "unrelated.txt"), "keep me");
    await run(1);
    expect((await readdir(dir)).sort()).toEqual([
      "manifesto-20260923-000000.db",
      "manifesto-20260923-010000.db",
      "unrelated.txt",
    ]);
  });

  it("refuses rather than fill the disk", async () => {
    const tight: BackupEnvironment = {
      freeBytes: async () => BACKUP_FREE_RESERVE_BYTES,
      databaseBytes: async () => 50 * 1024 ** 2,
    };
    await expect(run(0, tight)).rejects.toThrow(/Not enough free space/);
    expect(await readdir(dir)).toEqual([]);
  });

  it("measures the real volume and database", async () => {
    const env = fileSystemEnvironment(join(root, "manifesto.db"));
    expect(await env.databaseBytes()).toBeGreaterThan(0);
    expect(await env.freeBytes(root)).toBeGreaterThan(0);
  });

  it("names backups so they sort by time, and reads the time back", () => {
    const name = backupName(new Date("2026-09-23T10:15:00.000Z"));
    expect(name).toBe("manifesto-20260923-101500.db");
    expect(backupTime(name)).toBe(Date.parse("2026-09-23T10:15:00.000Z"));
    expect(backupTime("notes.db")).toBeNull();
  });
});
