import type {
  AccountKeysResponse,
  AccountKeysSetupRequest,
  AuditLogResponse,
  AuthSuccessResponse,
  RecoveryOpenResponse,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authHeaders,
  bootTestApp,
  bootTestAppWith,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";
import { MAX_LOGIN_FAILURES } from "./local/loginAttempts.js";

const PASSWORD = "test-pass-12";

/** Something shaped as a ciphertext, which is all the server asks. */
const sealed = (label: string) => `e1.${label.padEnd(40, "A")}`;
/** A P-256 point by its shape: 87 base64url characters, the first `B`. */
const point = (label: string) => `B${label.padEnd(86, "A")}`;
/** A recovery verifier by its shape: 43 base64url characters. */
const verifier = (label: string) => label.padEnd(43, "A");

function setup(label = "first"): AccountKeysSetupRequest {
  return {
    wrappedBySecret: sealed(`${label}-secret`),
    wrappedByRecovery: sealed(`${label}-recovery`),
    recoveryVerifier: verifier(label),
    publicKeys: { exchange: point("exchange"), signing: point("signing") },
    wrappedPrivateKeys: {
      exchange: sealed("exchange"),
      signing: sealed("signing"),
    },
  };
}

describe("account keys", () => {
  let rig: TestRig;
  let token: string;
  let userId: string;

  beforeEach(async () => {
    rig = await bootTestApp();
    ({ token, userId } = await registerTestUser(rig, "alice", PASSWORD));
  });

  afterEach(async () => {
    await rig.close();
  });

  const call = (
    method: string,
    path: string,
    body?: unknown,
    as: string | null = token,
  ) =>
    rig.request(path, {
      method,
      headers:
        as === null ? { "Content-Type": "application/json" } : authHeaders(as),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  const keys = async (as = token) =>
    (await (
      await call("GET", "/api/auth/keys", undefined, as)
    ).json()) as AccountKeysResponse;

  const login = async (password = PASSWORD) =>
    call("POST", "/api/auth/login", { username: "alice", password }, null);

  const actions = async () =>
    (
      (await (
        await call("GET", "/api/auth/me/activity")
      ).json()) as AuditLogResponse
    ).entries.map((entry) => entry.action);

  it("has none before set-up, and says when the session ends at the latest", async () => {
    const body = await keys();
    expect(body.keys).toBeNull();
    const days =
      (Date.parse(body.sessionEndsAt) - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(rig.cfg.sessionAbsoluteTtlDays - 1);
    expect(days).toBeLessThanOrEqual(rig.cfg.sessionAbsoluteTtlDays);
  });

  it("stores the first keys and hands back what unlocks, never the recovery half", async () => {
    expect((await call("PUT", "/api/auth/keys", setup())).status).toBe(204);
    const body = await keys();
    expect(body.keys).toEqual({
      version: 1,
      wrappedBySecret: sealed("first-secret"),
      publicKeys: { exchange: point("exchange"), signing: point("signing") },
      wrappedPrivateKeys: {
        exchange: sealed("exchange"),
        signing: sealed("signing"),
      },
    });
    expect(JSON.stringify(body)).not.toContain("recovery");
    // Only the hash of what the recovery key proves itself with is kept.
    const stored = await rig.storage.accountKeys.get(userId);
    expect(stored?.recoveryVerifierHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await actions()).toContain("keys.created");
  });

  it("refuses a second set-up", async () => {
    await call("PUT", "/api/auth/keys", setup());
    expect((await call("PUT", "/api/auth/keys", setup("second"))).status).toBe(
      409,
    );
    expect((await keys()).keys?.wrappedBySecret).toBe(sealed("first-secret"));
  });

  it("refuses anything that is not shaped as a ciphertext or a key", async () => {
    for (const broken of [
      { ...setup(), wrappedBySecret: "the account key, in the clear" },
      { ...setup(), wrappedBySecret: "e1.short" },
      { ...setup(), wrappedByRecovery: `${sealed("x")}=` },
      { ...setup(), wrappedBySecret: `e1.${"A".repeat(2000)}` },
      { ...setup(), recoveryVerifier: "short" },
      {
        ...setup(),
        publicKeys: { exchange: "A".repeat(87), signing: point("s") },
      },
      {
        ...setup(),
        wrappedPrivateKeys: { exchange: "pkcs8", signing: sealed("s") },
      },
    ]) {
      expect((await call("PUT", "/api/auth/keys", broken)).status).toBe(422);
    }
    expect((await keys()).keys).toBeNull();
  });

  it("is refused to an API token", async () => {
    const minted = await call("POST", "/api/tokens", {
      name: "x",
      password: PASSWORD,
    });
    const { secret } = (await minted.json()) as { secret: string };
    expect(
      (await call("GET", "/api/auth/keys", undefined, secret)).status,
    ).toBe(403);
    expect((await call("PUT", "/api/auth/keys", setup(), secret)).status).toBe(
      403,
    );
  });

  it("checks the password before the secret key is shown", async () => {
    const wrong = await call("POST", "/api/auth/keys/confirm", {
      password: "wrong-pass-00",
    });
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).code).toBe("password_incorrect");
    expect(
      (await call("POST", "/api/auth/keys/confirm", { password: PASSWORD }))
        .status,
    ).toBe(204);
  });

  describe("a new secret key", () => {
    beforeEach(async () => {
      await call("PUT", "/api/auth/keys", setup());
    });

    it("needs the password", async () => {
      const res = await call("POST", "/api/auth/keys/secret", {
        password: "wrong-pass-00",
        wrappedBySecret: sealed("new-secret"),
      });
      expect(res.status).toBe(403);
      expect((await keys()).keys?.wrappedBySecret).toBe(sealed("first-secret"));
    });

    it("replaces the wrap, signs the other devices out and keeps the tokens", async () => {
      const other = ((await (await login()).json()) as AuthSuccessResponse)
        .token;
      const minted = await call("POST", "/api/tokens", {
        name: "script",
        password: PASSWORD,
      });
      const { secret } = (await minted.json()) as { secret: string };

      const res = await call("POST", "/api/auth/keys/secret", {
        password: PASSWORD,
        wrappedBySecret: sealed("new-secret"),
      });
      expect(res.status).toBe(204);
      expect((await keys()).keys?.wrappedBySecret).toBe(sealed("new-secret"));
      expect((await call("GET", "/api/auth/me", undefined, other)).status).toBe(
        401,
      );
      expect((await call("GET", "/api/notes", undefined, secret)).status).toBe(
        200,
      );
      expect(await actions()).toContain("keys.secret_key_replaced");
    });
  });

  describe("a new recovery key", () => {
    beforeEach(async () => {
      await call("PUT", "/api/auth/keys", setup());
    });

    it("replaces the old one, which stops working", async () => {
      const res = await call("POST", "/api/auth/keys/recovery", {
        password: PASSWORD,
        wrappedByRecovery: sealed("new-recovery"),
        recoveryVerifier: verifier("new"),
      });
      expect(res.status).toBe(204);
      expect(
        (
          await call("POST", "/api/auth/keys/recover", {
            verifier: verifier("first"),
          })
        ).status,
      ).toBe(403);
      const opened = (await (
        await call("POST", "/api/auth/keys/recover", {
          verifier: verifier("new"),
        })
      ).json()) as RecoveryOpenResponse;
      expect(opened.wrappedByRecovery).toBe(sealed("new-recovery"));
      expect(await actions()).toContain("keys.recovery_key_replaced");
    });

    it("needs the password", async () => {
      const res = await call("POST", "/api/auth/keys/recovery", {
        wrappedByRecovery: sealed("new-recovery"),
        recoveryVerifier: verifier("new"),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("confirmation_required");
    });
  });

  describe("the recovery key, signed in", () => {
    beforeEach(async () => {
      await call("PUT", "/api/auth/keys", setup());
    });

    const next = {
      wrappedBySecret: sealed("next-secret"),
      wrappedByRecovery: sealed("next-recovery"),
      recoveryVerifier: verifier("next"),
    };

    it("hands over the wrapped account key to whoever holds it", async () => {
      const res = await call("POST", "/api/auth/keys/recover", {
        verifier: verifier("first"),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        userId,
        version: 1,
        wrappedByRecovery: sealed("first-recovery"),
        hasPassword: true,
      });
    });

    it("refuses a wrong one without ending the session", async () => {
      const res = await call("POST", "/api/auth/keys/recover", {
        verifier: verifier("wrong"),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("recovery_key_invalid");
      expect((await call("GET", "/api/auth/me")).status).toBe(200);
      expect(await actions()).toContain("auth.sign_in_failed");
    });

    it("puts new keys in place, once, and ends the other sessions and tokens", async () => {
      const other = ((await (await login()).json()) as AuthSuccessResponse)
        .token;
      const minted = await call("POST", "/api/tokens", {
        name: "script",
        password: PASSWORD,
      });
      const { secret } = (await minted.json()) as { secret: string };

      const res = await call("POST", "/api/auth/keys/recover/complete", {
        verifier: verifier("first"),
        ...next,
      });
      expect(res.status).toBe(204);
      expect((await keys()).keys?.wrappedBySecret).toBe(sealed("next-secret"));
      expect((await call("GET", "/api/auth/me", undefined, other)).status).toBe(
        401,
      );
      expect((await call("GET", "/api/notes", undefined, secret)).status).toBe(
        401,
      );
      // The key that was used is not the account's any more.
      const again = await call("POST", "/api/auth/keys/recover/complete", {
        verifier: verifier("first"),
        ...next,
      });
      expect(again.status).toBe(403);
      expect(await actions()).toContain("keys.recovery_key_used");
    });
  });

  describe("the recovery key, signed out", () => {
    beforeEach(async () => {
      await call("PUT", "/api/auth/keys", setup());
    });

    const open = (username: string, label: string) =>
      call(
        "POST",
        "/api/auth/recovery",
        { username, verifier: verifier(label) },
        null,
      );

    const complete = (label: string, newPassword = "a-new-pass-34") =>
      call(
        "POST",
        "/api/auth/recovery/complete",
        {
          username: "alice",
          verifier: verifier(label),
          newPassword,
          wrappedBySecret: sealed("next-secret"),
          wrappedByRecovery: sealed("next-recovery"),
          recoveryVerifier: verifier("next"),
        },
        null,
      );

    it("hands over the wrapped account key for the username and the key", async () => {
      const res = await open("alice", "first");
      expect(res.status).toBe(200);
      expect(((await res.json()) as RecoveryOpenResponse).userId).toBe(userId);
    });

    it("answers a wrong key and a name nobody holds alike", async () => {
      const wrong = await open("alice", "wrong");
      const nobody = await open("nobody", "first");
      expect(wrong.status).toBe(401);
      expect(nobody.status).toBe(401);
      expect(await wrong.json()).toEqual(await nobody.json());
    });

    it("signs in with a new password and new keys, and ends everything else", async () => {
      const res = await complete("first");
      expect(res.status).toBe(200);
      const body = (await res.json()) as AuthSuccessResponse;
      expect(body.user.id).toBe(userId);
      // The session from before the recovery is over; the new one works.
      expect((await call("GET", "/api/auth/me")).status).toBe(401);
      expect((await keys(body.token)).keys?.wrappedBySecret).toBe(
        sealed("next-secret"),
      );
      expect((await login()).status).toBe(401);
      expect((await login("a-new-pass-34")).status).toBe(200);
      // Spent: the key on the old sheet opens nothing now.
      expect((await complete("first")).status).toBe(401);
    });

    it("signs in past a second factor that was lost", async () => {
      await rig.storage.twoFactor.begin(userId, "JBSWY3DPEHPK3PXP", "t");
      await rig.storage.twoFactor.enable(userId, "t", 1);
      expect((await login()).status).toBe(403);
      expect((await complete("first")).status).toBe(200);
    });

    it("counts wrong keys against the name, like wrong passwords", async () => {
      // Behind a proxy, so each try can come from an address of its own and
      // only the per-name count is left.
      await rig.close();
      rig = await bootTestAppWith({ trustProxy: true });
      ({ token, userId } = await registerTestUser(rig, "alice", PASSWORD));
      await call("PUT", "/api/auth/keys", setup());
      const from = (address: number, label: string) =>
        rig.request("/api/auth/recovery", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": `2001:db8:0:${address.toString(16)}::1`,
          },
          body: JSON.stringify({
            username: "alice",
            verifier: verifier(label),
          }),
        });
      for (let i = 0; i < MAX_LOGIN_FAILURES; i++) {
        expect((await from(i, "wrong")).status).toBe(401);
      }
      const locked = await from(MAX_LOGIN_FAILURES, "first");
      expect(locked.status).toBe(429);
      expect(locked.headers.get("Retry-After")).not.toBeNull();
    });

    it("does not sign in an account that has no password here", async () => {
      await rig.storage.users.create({
        id: "sso-1",
        username: "sam",
        displayName: "Sam",
        avatarColor: "#123456",
        provider: "oidc",
        externalId: "sub-1",
        passwordHash: null,
        createdAt: new Date().toISOString(),
      });
      await rig.storage.accountKeys.create({
        ...(await rig.storage.accountKeys.get(userId)),
        userId: "sso-1",
      } as never);
      expect((await open("sam", "first")).status).toBe(401);
    });
  });

  describe("starting again", () => {
    beforeEach(async () => {
      await call("PUT", "/api/auth/keys", setup());
    });

    it("needs the password", async () => {
      const res = await call("DELETE", "/api/auth/keys", {
        password: "wrong-pass-00",
      });
      expect(res.status).toBe(403);
      expect((await keys()).keys).not.toBeNull();
    });

    it("removes the keys, so the account is set up anew", async () => {
      const other = ((await (await login()).json()) as AuthSuccessResponse)
        .token;
      const res = await call("DELETE", "/api/auth/keys", {
        password: PASSWORD,
      });
      expect(res.status).toBe(204);
      expect((await keys()).keys).toBeNull();
      expect((await call("GET", "/api/auth/me", undefined, other)).status).toBe(
        401,
      );
      expect(
        (await call("PUT", "/api/auth/keys", setup("second"))).status,
      ).toBe(204);
      expect(await actions()).toContain("keys.started_again");
    });

    it("keeps the keys when emptying the account fails, so it can be tried again", async () => {
      const clear = vi
        .spyOn(rig.storage.prefs, "clear")
        .mockRejectedValueOnce(new Error("the database is busy"));
      const failed = await call("DELETE", "/api/auth/keys", {
        password: PASSWORD,
      });
      expect(failed.status).toBe(500);
      expect((await keys()).keys).not.toBeNull();
      expect(await actions()).not.toContain("keys.started_again");

      const again = await call("DELETE", "/api/auth/keys", {
        password: PASSWORD,
      });
      expect(again.status).toBe(204);
      expect((await keys()).keys).toBeNull();
      clear.mockRestore();
    });
  });
});
