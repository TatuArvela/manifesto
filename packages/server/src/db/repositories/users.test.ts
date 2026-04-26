import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DB, openDatabase } from "../index.js";
import { createUsersRepo, type UsersRepo } from "./users.js";

describe("usersRepo", () => {
  let db: DB;
  let repo: UsersRepo;

  beforeEach(() => {
    db = openDatabase(":memory:");
    repo = createUsersRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates and retrieves a user by id and username", async () => {
    const user = await repo.create({
      id: "user-1",
      username: "alice",
      passwordHash: "hashed",
      displayName: "Alice",
      avatarColor: "#abc",
      createdAt: "2026-04-01T00:00:00Z",
    });
    expect(user.username).toBe("alice");
    expect(await repo.findById("user-1")).toMatchObject({ username: "alice" });
    expect(await repo.findByUsername("alice")).toMatchObject({ id: "user-1" });
  });

  it("matches usernames case-insensitively", async () => {
    await repo.create({
      id: "user-1",
      username: "Alice",
      passwordHash: "hashed",
      displayName: "",
      avatarColor: "",
      createdAt: "2026-04-01T00:00:00Z",
    });
    expect(await repo.findByUsername("alice")).not.toBeNull();
    expect(await repo.findByUsername("ALICE")).not.toBeNull();
  });

  it("rejects duplicate usernames at the DB layer", async () => {
    await repo.create({
      id: "user-1",
      username: "alice",
      passwordHash: "h",
      displayName: "",
      avatarColor: "",
      createdAt: "2026-04-01T00:00:00Z",
    });
    await expect(
      repo.create({
        id: "user-2",
        username: "ALICE",
        passwordHash: "h",
        displayName: "",
        avatarColor: "",
        createdAt: "2026-04-01T00:00:00Z",
      }),
    ).rejects.toThrow();
  });

  it("returns null for missing users", async () => {
    expect(await repo.findById("nope")).toBeNull();
    expect(await repo.findByUsername("nope")).toBeNull();
  });
});
