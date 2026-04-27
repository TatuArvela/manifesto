import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsernameTakenError, type UsersRepo } from "../types.js";
import { openDatabase, type SqliteDB } from "./database.js";
import { createSqliteUsersRepo } from "./usersRepo.js";

describe("sqlite usersRepo", () => {
  let db: SqliteDB;
  let repo: UsersRepo;

  beforeEach(() => {
    db = openDatabase(":memory:");
    repo = createSqliteUsersRepo(db);
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
      provider: "local",
      externalId: null,
      createdAt: "2026-04-01T00:00:00Z",
    });
    expect(user.username).toBe("alice");
    expect(user.passwordHash).toBe("hashed");
    expect(user.provider).toBe("local");
    expect(user.externalId).toBeNull();
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
      provider: "local",
      externalId: null,
      createdAt: "2026-04-01T00:00:00Z",
    });
    expect(await repo.findByUsername("alice")).not.toBeNull();
    expect(await repo.findByUsername("ALICE")).not.toBeNull();
  });

  it("rejects duplicate usernames with UsernameTakenError", async () => {
    await repo.create({
      id: "user-1",
      username: "alice",
      passwordHash: "h",
      displayName: "",
      avatarColor: "",
      provider: "local",
      externalId: null,
      createdAt: "2026-04-01T00:00:00Z",
    });
    await expect(
      repo.create({
        id: "user-2",
        username: "ALICE",
        passwordHash: "h",
        displayName: "",
        avatarColor: "",
        provider: "local",
        externalId: null,
        createdAt: "2026-04-01T00:00:00Z",
      }),
    ).rejects.toBeInstanceOf(UsernameTakenError);
  });

  it("returns null for missing users", async () => {
    expect(await repo.findById("nope")).toBeNull();
    expect(await repo.findByUsername("nope")).toBeNull();
    expect(await repo.findByExternalId("oidc:example", "nope")).toBeNull();
  });

  it("stores and looks up SSO users by (provider, externalId)", async () => {
    await repo.create({
      id: "user-sso",
      username: "alice@idp",
      passwordHash: null,
      displayName: "Alice",
      avatarColor: "#abc",
      provider: "oidc:example",
      externalId: "sub-12345",
      createdAt: "2026-04-01T00:00:00Z",
    });
    const found = await repo.findByExternalId("oidc:example", "sub-12345");
    expect(found?.id).toBe("user-sso");
    expect(found?.passwordHash).toBeNull();
    expect(found?.provider).toBe("oidc:example");
    expect(found?.externalId).toBe("sub-12345");
  });

  it("scopes externalId uniqueness by provider", async () => {
    await repo.create({
      id: "u-a",
      username: "a",
      passwordHash: null,
      displayName: "",
      avatarColor: "",
      provider: "oidc:a",
      externalId: "shared",
      createdAt: "2026-04-01T00:00:00Z",
    });
    await repo.create({
      id: "u-b",
      username: "b",
      passwordHash: null,
      displayName: "",
      avatarColor: "",
      provider: "oidc:b",
      externalId: "shared",
      createdAt: "2026-04-01T00:00:00Z",
    });
    expect((await repo.findByExternalId("oidc:a", "shared"))?.id).toBe("u-a");
    expect((await repo.findByExternalId("oidc:b", "shared"))?.id).toBe("u-b");
  });
});
