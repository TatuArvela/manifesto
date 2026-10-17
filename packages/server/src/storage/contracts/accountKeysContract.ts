import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageDriver, StoredAccountKeys } from "#/storage/types.js";

/**
 * An account's wrapped keys, the same in both drivers: the first set-up is
 * the one kept, a recovery key is spent once, and the keys go with the
 * account.
 */

const T0 = "2026-04-01T00:00:00.000Z";
const T1 = "2026-04-02T00:00:00.000Z";

function keys(overrides: Partial<StoredAccountKeys> = {}): StoredAccountKeys {
  return {
    userId: "u1",
    version: 1,
    wrappedBySecret: "e1.secret",
    wrappedByRecovery: "e1.recovery",
    recoveryVerifierHash: "hash-1",
    exchangePublicKey: "exchange",
    signingPublicKey: "signing",
    wrappedExchangePrivateKey: "e1.exchange",
    wrappedSigningPrivateKey: "e1.signing",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export function describeAccountKeysContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: account keys`, () => {
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

    it("has none until an account is set up, and then gives them back", async () => {
      expect(await storage.accountKeys.get("u1")).toBeNull();
      expect(await storage.accountKeys.create(keys())).toBe(true);
      expect(await storage.accountKeys.get("u1")).toEqual(keys());
      expect(await storage.accountKeys.get("u2")).toBeNull();
    });

    it("keeps the first set-up and refuses a second", async () => {
      await storage.accountKeys.create(keys());
      expect(
        await storage.accountKeys.create(keys({ wrappedBySecret: "e1.other" })),
      ).toBe(false);
      expect((await storage.accountKeys.get("u1"))?.wrappedBySecret).toBe(
        "e1.secret",
      );
    });

    it("puts a new secret key in place and leaves the recovery key", async () => {
      await storage.accountKeys.create(keys());
      expect(await storage.accountKeys.setSecretWrap("u1", "e1.new", T1)).toBe(
        true,
      );
      expect(await storage.accountKeys.get("u1")).toEqual(
        keys({ wrappedBySecret: "e1.new", updatedAt: T1 }),
      );
      expect(await storage.accountKeys.setSecretWrap("u2", "e1.new", T1)).toBe(
        false,
      );
    });

    it("puts a new recovery key in place and leaves the secret key", async () => {
      await storage.accountKeys.create(keys());
      expect(
        await storage.accountKeys.setRecovery("u1", "e1.new", "hash-2", T1),
      ).toBe(true);
      expect(await storage.accountKeys.get("u1")).toEqual(
        keys({
          wrappedByRecovery: "e1.new",
          recoveryVerifierHash: "hash-2",
          updatedAt: T1,
        }),
      );
      expect(
        await storage.accountKeys.setRecovery("u2", "e1.new", "hash-2", T1),
      ).toBe(false);
    });

    it("spends a recovery key once", async () => {
      await storage.accountKeys.create(keys());
      const next = {
        wrappedBySecret: "e1.secret-2",
        wrappedByRecovery: "e1.recovery-2",
        recoveryVerifierHash: "hash-2",
      };
      expect(
        await storage.accountKeys.replaceUserKeys("u1", "hash-1", next, T1),
      ).toBe(true);
      expect(await storage.accountKeys.get("u1")).toEqual(
        keys({ ...next, updatedAt: T1 }),
      );
      // The key it was is no longer the account's.
      expect(
        await storage.accountKeys.replaceUserKeys(
          "u1",
          "hash-1",
          { ...next, wrappedBySecret: "e1.third" },
          T1,
        ),
      ).toBe(false);
      expect((await storage.accountKeys.get("u1"))?.wrappedBySecret).toBe(
        "e1.secret-2",
      );
    });

    it("removes an account's keys, and only that account's", async () => {
      await storage.accountKeys.create(keys());
      await storage.accountKeys.create(keys({ userId: "u2" }));
      expect(await storage.accountKeys.delete("u1")).toBe(true);
      expect(await storage.accountKeys.delete("u1")).toBe(false);
      expect(await storage.accountKeys.get("u1")).toBeNull();
      expect(await storage.accountKeys.get("u2")).not.toBeNull();
    });

    it("remembers the keys an account has seen of others, up to a limit, until its own keys go", async () => {
      const me = "u1";
      await storage.accountKeys.create(keys());
      expect(await storage.accountKeys.seenKeys(me)).toEqual({});
      const remember = (peer: string, sealed: string, max = 2) =>
        storage.accountKeys.rememberKey(me, peer, `e1.${sealed}`, T0, max);
      expect(await remember("alice", "a1")).toBe(true);
      expect(await remember("bob", "b1")).toBe(true);
      // One more than it may hold is refused; one it already holds is
      // written over.
      expect(await remember("carol", "c1")).toBe(false);
      expect(await remember("alice", "a2")).toBe(true);
      expect(await storage.accountKeys.seenKeys(me)).toEqual({
        alice: "e1.a2",
        bob: "e1.b1",
      });
      // Sealed under the account's keys, they go when those do.
      await storage.accountKeys.delete(me);
      expect(await storage.accountKeys.seenKeys(me)).toEqual({});
    });
  });
}
