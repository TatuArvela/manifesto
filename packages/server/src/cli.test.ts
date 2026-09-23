import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "./cli.js";
import { createStorage } from "./storage/index.js";
import type { StorageDriver } from "./storage/types.js";
import { TEST_CONFIG } from "./test/setup.js";

describe("admin CLI", () => {
  let storage: StorageDriver;
  let lines: string[];
  const run = (...args: string[]) =>
    runCli(args, {
      storage,
      cfg: TEST_CONFIG,
      out: (line) => lines.push(line),
    });

  beforeEach(async () => {
    storage = await createStorage(TEST_CONFIG);
    lines = [];
    await storage.users.create({
      id: "u1",
      username: "alice",
      displayName: "alice",
      avatarColor: "",
      provider: "local",
      externalId: null,
      passwordHash: "old-hash",
      createdAt: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 20));
    await storage.close();
  });

  it("resets a password to a printed temporary one, and clears sessions and two-factor", async () => {
    await storage.sessions.create({
      token: "hash",
      userId: "u1",
      createdAt: new Date().toISOString(),
      expiresAt: "2999-01-01T00:00:00.000Z",
      lastSeenAt: new Date().toISOString(),
    });
    await storage.twoFactor.begin("u1", "SECRET", new Date().toISOString());
    await storage.twoFactor.enable("u1", new Date().toISOString(), 1);
    expect(await run("reset-password", "alice")).toBe(0);
    expect(lines[0]).toMatch(/^Temporary password for alice: \S+/);
    const user = await storage.users.findByUsername("alice");
    expect(user?.mustChangePassword).toBe(true);
    expect(user?.passwordHash).not.toBe("old-hash");
    expect(await storage.sessions.findByToken("hash")).toBeNull();
    expect(await storage.twoFactor.get("u1")).toBeNull();
  });

  it("makes an admin, and lists them", async () => {
    await storage.users.create({
      id: "u2",
      username: "bob",
      displayName: "bob",
      avatarColor: "",
      provider: "local",
      externalId: null,
      passwordHash: "h",
      createdAt: new Date().toISOString(),
    });
    expect(await run("make-admin", "bob")).toBe(0);
    lines = [];
    await run("list-admins");
    expect(lines.map((l) => l.split("\t")[0])).toEqual(["alice", "bob"]);
  });

  it("creates an admin with a temporary password", async () => {
    expect(await run("create-admin", "rescue")).toBe(0);
    expect(lines[0]).toMatch(/^Created admin rescue\. Temporary password: /);
    expect((await storage.users.findByUsername("rescue"))?.isAdmin).toBe(true);
    expect(await run("create-admin", "rescue")).toBe(1);
  });

  it("says what it could not do, and how it is used", async () => {
    expect(await run("reset-password", "nobody")).toBe(1);
    expect(lines).toEqual(["No account is called nobody."]);
    expect(await run("frobnicate")).toBe(1);
    expect(await run()).toBe(0);
    expect(lines.at(-1)).toContain("Usage:");
  });
});
