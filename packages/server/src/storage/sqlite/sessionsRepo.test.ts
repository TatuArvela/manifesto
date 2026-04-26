import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionsRepo } from "../types.js";
import { openDatabase, type SqliteDB } from "./database.js";
import { createSqliteSessionsRepo } from "./sessionsRepo.js";
import { createSqliteUsersRepo } from "./usersRepo.js";

describe("sqlite sessionsRepo", () => {
  let db: SqliteDB;
  let repo: SessionsRepo;

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
      createdAt: "2026-04-01T00:00:00Z",
    });
    repo = createSqliteSessionsRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates, finds, and deletes sessions", async () => {
    const created = await repo.create({
      token: "tok",
      userId: "u1",
      createdAt: "2026-04-01T00:00:00Z",
      expiresAt: "2026-05-01T00:00:00Z",
      lastSeenAt: "2026-04-01T00:00:00Z",
    });
    expect(created.token).toBe("tok");
    expect(await repo.findByToken("tok")).toMatchObject({ userId: "u1" });

    await repo.deleteByToken("tok");
    expect(await repo.findByToken("tok")).toBeNull();
  });

  it("touches a session, rolling its expiry forward", async () => {
    await repo.create({
      token: "tok",
      userId: "u1",
      createdAt: "2026-04-01T00:00:00Z",
      expiresAt: "2026-04-10T00:00:00Z",
      lastSeenAt: "2026-04-01T00:00:00Z",
    });
    await repo.touch("tok", "2026-04-05T00:00:00Z", "2026-05-05T00:00:00Z");
    const after = await repo.findByToken("tok");
    expect(after?.expiresAt).toBe("2026-05-05T00:00:00Z");
    expect(after?.lastSeenAt).toBe("2026-04-05T00:00:00Z");
  });

  it("deletes expired sessions", async () => {
    await repo.create({
      token: "old",
      userId: "u1",
      createdAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-02-01T00:00:00Z",
      lastSeenAt: "2026-01-01T00:00:00Z",
    });
    await repo.create({
      token: "fresh",
      userId: "u1",
      createdAt: "2026-04-01T00:00:00Z",
      expiresAt: "2026-05-01T00:00:00Z",
      lastSeenAt: "2026-04-01T00:00:00Z",
    });
    const removed = await repo.deleteExpired("2026-03-01T00:00:00Z");
    expect(removed).toBe(1);
    expect(await repo.findByToken("old")).toBeNull();
    expect(await repo.findByToken("fresh")).not.toBeNull();
  });
});
