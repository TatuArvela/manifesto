import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageDriver, StoredPasskey } from "../types.js";

/**
 * Passkeys, the same in both drivers: a counter past 2^31 comes back as a
 * number (Postgres hands a BIGINT over as a string), and one user cannot
 * remove another's.
 */

const T0 = "2026-04-01T00:00:00.000Z";
const T1 = "2026-04-02T00:00:00.000Z";

function passkey(overrides: Partial<StoredPasskey> = {}): StoredPasskey {
  return {
    id: "p1",
    userId: "u1",
    credentialId: "cred-1",
    publicKey: "pQECAyYgASFYIA",
    counter: 0,
    transports: ["internal", "hybrid"],
    rpId: "notes.example",
    name: "Laptop",
    synced: true,
    createdAt: T0,
    lastUsedAt: null,
    ...overrides,
  };
}

export function describePasskeysContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: passkeys`, () => {
    let storage: StorageDriver;

    beforeEach(async () => {
      storage = await boot();
      for (const id of ["u1", "u2"]) {
        await storage.users.create({
          id,
          username: id,
          passwordHash: "h",
          displayName: "",
          avatarColor: "#123456",
          provider: "local",
          externalId: null,
          createdAt: T0,
        });
      }
    });

    afterEach(async () => {
      await storage.close();
    });

    it("keeps a passkey and finds it by its credential", async () => {
      await storage.passkeys.create(passkey());
      await storage.passkeys.create(
        passkey({
          id: "p2",
          credentialId: "cred-2",
          synced: false,
          createdAt: T1,
        }),
      );
      expect(await storage.passkeys.findByCredentialId("cred-1")).toEqual(
        passkey(),
      );
      expect(
        (await storage.passkeys.listByUser("u1")).map((p) => [p.id, p.synced]),
      ).toEqual([
        ["p1", true],
        ["p2", false],
      ]);
      expect(await storage.passkeys.findByCredentialId("nope")).toBeNull();
    });

    it("records a use with a counter past 2^31", async () => {
      await storage.passkeys.create(passkey());
      await storage.passkeys.recordUse("p1", 3_000_000_000, T1);
      const used = await storage.passkeys.findByCredentialId("cred-1");
      expect(used?.counter).toBe(3_000_000_000);
      expect(used?.lastUsedAt).toBe(T1);
    });

    it("removes only the owner's", async () => {
      await storage.passkeys.create(passkey());
      expect(await storage.passkeys.delete("p1", "u2")).toBe(false);
      expect(await storage.passkeys.delete("p1", "u1")).toBe(true);
      await storage.passkeys.create(passkey({ id: "p3", credentialId: "c3" }));
      expect(await storage.passkeys.deleteByUser("u1")).toBe(1);
      expect(await storage.passkeys.listByUser("u1")).toEqual([]);
    });
  });
}
