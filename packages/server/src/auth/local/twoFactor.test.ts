import type {
  TwoFactorRecoveryCodesResponse,
  TwoFactorSetupResponse,
  TwoFactorStatusResponse,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "../../test/setup.js";
import { base32Decode, hotp, totpStep } from "../totp.js";

const PASSWORD = "test-pass-12";

describe("two-factor sign-in", () => {
  let rig: TestRig;
  let token: string;

  beforeEach(async () => {
    rig = await bootTestApp();
    ({ token } = await registerTestUser(rig, "alice", PASSWORD));
  });

  afterEach(async () => {
    await rig.close();
  });

  const call = (method: string, path: string, body?: unknown, as = token) =>
    rig.request(path, {
      method,
      headers: authHeaders(as),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  const login = (extra: object = {}) =>
    rig.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: PASSWORD, ...extra }),
    });

  const codeAt = (secret: string, offsetSteps = 0) =>
    hotp(base32Decode(secret), totpStep(Date.now()) + offsetSteps);

  /** Turns two-factor on; returns the secret and the recovery codes. */
  async function turnOn() {
    const setup = await call("POST", "/api/auth/two-factor/setup", {
      password: PASSWORD,
    });
    expect(setup.status).toBe(200);
    const { secret } = (await setup.json()) as TwoFactorSetupResponse;
    // One step back, so the sign-in in the tests can use the current one.
    const enabled = await call("POST", "/api/auth/two-factor/enable", {
      code: codeAt(secret, -1),
    });
    expect(enabled.status).toBe(200);
    const { recoveryCodes } =
      (await enabled.json()) as TwoFactorRecoveryCodesResponse;
    return { secret, recoveryCodes };
  }

  it("asks for a code after the password, and signs in with one", async () => {
    const { secret } = await turnOn();
    const asked = await login();
    expect(asked.status).toBe(403);
    expect((await asked.json()).code).toBe("two_factor_required");
    expect((await login({ otp: "000000" })).status).toBe(401);
    expect((await login({ otp: codeAt(secret) })).status).toBe(200);
  });

  it("never asks a wrong password for a code", async () => {
    await turnOn();
    const res = await rig.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "wrong-pass-00" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBeUndefined();
  });

  it("takes each code once", async () => {
    const { secret } = await turnOn();
    const code = codeAt(secret);
    expect((await login({ otp: code })).status).toBe(200);
    expect((await login({ otp: code })).status).toBe(401);
  });

  it("takes a recovery code once, however it is typed", async () => {
    const { recoveryCodes } = await turnOn();
    const typed = recoveryCodes[0].toUpperCase().replace("-", " ");
    expect((await login({ otp: typed })).status).toBe(200);
    expect((await login({ otp: recoveryCodes[0] })).status).toBe(401);
    const status = (await (
      await call("GET", "/api/auth/two-factor")
    ).json()) as TwoFactorStatusResponse;
    expect(status).toEqual({ enabled: true, recoveryCodesRemaining: 9 });
  });

  it("needs the password to turn it off, and then asks for no code", async () => {
    await turnOn();
    expect(
      (
        await call("POST", "/api/auth/two-factor/disable", {
          password: "wrong-pass-00",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("POST", "/api/auth/two-factor/disable", {
          password: PASSWORD,
        })
      ).status,
    ).toBe(204);
    expect((await login()).status).toBe(200);
  });

  it("refuses a wrong confirmation code and stays off", async () => {
    await call("POST", "/api/auth/two-factor/setup", { password: PASSWORD });
    const res = await call("POST", "/api/auth/two-factor/enable", {
      code: "000000",
    });
    expect(res.status).toBe(422);
    expect((await login()).status).toBe(200);
  });

  it("is refused to an API token", async () => {
    const minted = await call("POST", "/api/tokens", { name: "x" });
    const { secret } = (await minted.json()) as { secret: string };
    expect(
      (await call("GET", "/api/auth/two-factor", undefined, secret)).status,
    ).toBe(403);
  });

  it("goes when an admin issues a temporary password", async () => {
    await turnOn();
    const { token: bob, userId: bobId } = await registerTestUser(rig, "bob");
    // An admin cannot reset their own password here, so a second admin
    // resets Alice's.
    await rig.storage.users.setAdmin(bobId, true);
    const alice = await rig.storage.users.findByUsername("alice");
    const reset = await call(
      "POST",
      `/api/admin/users/${alice?.id}/password`,
      undefined,
      bob,
    );
    expect(reset.status).toBe(200);
    expect(await rig.storage.twoFactor.get(alice?.id ?? "")).toBeNull();
  });
});
