import { describe, expect, it } from "vitest";
import type { StorageDriver } from "./types.js";

const T = "2026-04-01T00:00:00.000Z";

async function withUser(storage: StorageDriver, id = "u1") {
  await storage.users.create({
    id,
    username: id,
    passwordHash: "h",
    displayName: "",
    avatarColor: "",
    provider: "local",
    externalId: null,
    createdAt: T,
  });
}

/**
 * An account's preferences, merged the same way by both drivers.
 * `locks: false` skips the case two writers race in, for pg-mem, which does
 * not implement `FOR UPDATE`; real Postgres does, and serializes them.
 */
export function describePrefsContract(
  name: string,
  boot: () => Promise<StorageDriver>,
  { locks = true }: { locks?: boolean } = {},
): void {
  describe(`${name}: preferences`, () => {
    it("starts empty, merges, and removes a key set to null", async () => {
      const storage = await boot();
      await withUser(storage);
      expect(await storage.prefs.get("u1")).toEqual({});
      await storage.prefs.merge(
        "u1",
        { theme: "dark", hiddenTags: ["work"] },
        T,
        16_384,
      );
      expect(
        await storage.prefs.merge(
          "u1",
          { theme: null, locale: "fi" },
          T,
          16_384,
        ),
      ).toEqual({ hiddenTags: ["work"], locale: "fi" });
      expect(await storage.prefs.get("u1")).toEqual({
        hiddenTags: ["work"],
        locale: "fi",
      });
    });

    it.skipIf(!locks)("keeps both of two patches sent at once", async () => {
      const storage = await boot();
      await withUser(storage);
      await Promise.all([
        storage.prefs.merge("u1", { theme: "dark" }, T, 16_384),
        storage.prefs.merge("u1", { locale: "fi" }, T, 16_384),
      ]);
      expect(await storage.prefs.get("u1")).toEqual({
        theme: "dark",
        locale: "fi",
      });
    });

    it("refuses a patch past the limit and writes nothing", async () => {
      const storage = await boot();
      await withUser(storage);
      await storage.prefs.merge("u1", { theme: "dark" }, T, 64);
      expect(
        await storage.prefs.merge("u1", { big: "x".repeat(100) }, T, 64),
      ).toBe("tooLarge");
      expect(await storage.prefs.get("u1")).toEqual({ theme: "dark" });
    });

    it("keeps each account's apart, and goes with the account", async () => {
      const storage = await boot();
      await withUser(storage, "u1");
      await withUser(storage, "u2");
      await storage.prefs.merge("u1", { theme: "dark" }, T, 16_384);
      expect(await storage.prefs.get("u2")).toEqual({});
      await storage.users.create({
        id: "u3",
        username: "admin3",
        passwordHash: "h",
        displayName: "",
        avatarColor: "",
        provider: "local",
        externalId: null,
        createdAt: T,
        isAdmin: true,
      });
      await storage.users.delete("u1");
      expect(await storage.prefs.get("u1")).toEqual({});
    });
  });
}
