import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageDriver, StoredOAuthCode } from "../types.js";

/**
 * The OAuth rows, the same in both drivers: a code is good once and not after
 * it expires, a grant's refresh token is replaced by exactly one refresh, and
 * a client never given a grant is swept.
 */

const T0 = "2026-04-01T00:00:00.000Z";
const T1 = "2026-04-02T00:00:00.000Z";
const T1_LATER = "2026-04-02T01:00:00.000Z";
const T2 = "2026-04-03T00:00:00.000Z";

function code(overrides: Partial<StoredOAuthCode> = {}): StoredOAuthCode {
  return {
    codeHash: "code-1",
    clientId: "https://assistant.example/client.json",
    clientName: "Assistant",
    userId: "u1",
    redirectUri: "http://localhost:4000/callback",
    codeChallenge: "challenge",
    scopes: ["notes:read", "notes:write"],
    grantExpiresAt: null,
    expiresAt: T1,
    ...overrides,
  };
}

export function describeOAuthContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: OAuth`, () => {
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

    it("redeems a code once, and not once it has expired", async () => {
      await storage.oauth.createCode(code());
      expect(await storage.oauth.redeemCode("code-1", T0)).toEqual(code());
      expect(await storage.oauth.redeemCode("code-1", T0)).toBeNull();

      await storage.oauth.createCode(code({ codeHash: "code-2" }));
      expect(await storage.oauth.redeemCode("code-2", T2)).toBeNull();
      // Taken out all the same.
      expect(await storage.oauth.redeemCode("code-2", T0)).toBeNull();
    });

    it("sweeps expired codes", async () => {
      await storage.oauth.createCode(code());
      await storage.oauth.createCode(
        code({ codeHash: "later", expiresAt: T2 }),
      );
      expect(await storage.oauth.deleteExpiredCodes(T1_LATER)).toBe(1);
      expect(await storage.oauth.redeemCode("later", T0)).not.toBeNull();
    });

    it("keeps a registered client until it is swept unused", async () => {
      await storage.oauth.createClient({
        id: "c1",
        name: "Assistant",
        redirectUris: ["http://localhost:4000/callback"],
        createdAt: T0,
        lastUsedAt: null,
      });
      await storage.oauth.createClient({
        id: "c2",
        name: "Used",
        redirectUris: ["https://used.example/cb"],
        createdAt: T0,
        lastUsedAt: null,
      });
      expect((await storage.oauth.getClient("c1"))?.redirectUris).toEqual([
        "http://localhost:4000/callback",
      ]);
      await storage.oauth.touchClient("c2", T1);
      expect(await storage.oauth.deleteUnusedClients(T1)).toBe(1);
      expect(await storage.oauth.getClient("c1")).toBeNull();
      expect((await storage.oauth.getClient("c2"))?.lastUsedAt).toBe(T1);
    });

    it("rotates a grant's secrets once per refresh token", async () => {
      await storage.apiTokens.create({
        id: "g1",
        userId: "u1",
        name: "Assistant",
        kind: "mcp",
        scopes: ["notes:read"],
        prefix: "mfm_abcdef",
        createdAt: T0,
        lastUsedAt: null,
        expiresAt: null,
        oauthClientId: "c1",
        accessExpiresAt: T1,
        tokenHash: "access-1",
        refreshHash: "refresh-1",
      });
      const grant = await storage.apiTokens.findByRefreshHash("refresh-1");
      expect(grant).toMatchObject({
        id: "g1",
        oauthClientId: "c1",
        accessExpiresAt: T1,
      });
      expect((await storage.apiTokens.listByUser("u1"))[0]).toEqual({
        id: "g1",
        name: "Assistant",
        kind: "mcp",
        scopes: ["notes:read"],
        prefix: "mfm_abcdef",
        createdAt: T0,
        lastUsedAt: null,
        expiresAt: null,
        oauthClientId: "c1",
      });

      const next = {
        tokenHash: "access-2",
        refreshHash: "refresh-2",
        accessExpiresAt: T2,
      };
      expect(await storage.apiTokens.rotate("refresh-1", next)).toBe(true);
      expect(await storage.apiTokens.rotate("refresh-1", next)).toBe(false);
      expect(await storage.apiTokens.findByHash("access-1")).toBeNull();
      expect(
        (await storage.apiTokens.findByHash("access-2"))?.accessExpiresAt,
      ).toBe(T2);
      expect(await storage.apiTokens.findByRefreshHash("refresh-1")).toBeNull();
      expect(
        (await storage.apiTokens.findByPreviousRefreshHash("refresh-1"))?.id,
      ).toBe("g1");
      expect((await storage.apiTokens.findByRefreshHash("refresh-2"))?.id).toBe(
        "g1",
      );
    });

    it("gives a token minted by hand no grant fields", async () => {
      await storage.apiTokens.create({
        id: "t1",
        userId: "u1",
        name: "script",
        kind: "api",
        scopes: ["notes:read"],
        prefix: "mfp_abcdef",
        createdAt: T0,
        lastUsedAt: null,
        expiresAt: null,
        accessExpiresAt: null,
        tokenHash: "hand",
      });
      const stored = await storage.apiTokens.findByHash("hand");
      expect(stored?.accessExpiresAt).toBeNull();
      expect(stored).not.toHaveProperty("oauthClientId");
    });
  });
}
