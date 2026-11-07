import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageDriver } from "#/storage/types.ts";

/**
 * Two-factor setup, the same in both drivers: a setup starts again with a new
 * secret, and an authenticator that is on refuses a new setup.
 */

const T0 = "2026-04-01T00:00:00.000Z";
const T1 = "2026-04-02T00:00:00.000Z";

export function describeTwoFactorContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: two-factor`, () => {
    let storage: StorageDriver;

    beforeEach(async () => {
      storage = await boot();
      await storage.users.create({
        id: "u1",
        username: "u1",
        passwordHash: "h",
        displayName: "",
        avatarColor: "#123456",
        provider: "local",
        externalId: null,
        createdAt: T0,
      });
    });

    afterEach(async () => {
      await storage.close();
    });

    it("starts a setup, and starts it again with a new secret", async () => {
      expect(await storage.twoFactor.begin("u1", "first", T0)).toBe(true);
      await storage.twoFactor.advanceStep("u1", 7);
      expect(await storage.twoFactor.begin("u1", "second", T1)).toBe(true);
      expect(await storage.twoFactor.get("u1")).toEqual({
        secret: "second",
        enabledAt: null,
        lastStep: 0,
      });
    });

    it("refuses a new setup while two-factor is on", async () => {
      await storage.twoFactor.begin("u1", "first", T0);
      await storage.twoFactor.enable("u1", T0, 3);
      expect(await storage.twoFactor.begin("u1", "second", T1)).toBe(false);
      expect(await storage.twoFactor.get("u1")).toEqual({
        secret: "first",
        enabledAt: T0,
        lastStep: 3,
      });
    });
  });
}
