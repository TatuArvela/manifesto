import type {
  AuthSuccessResponse,
  PasskeyAddedResponse,
  PasskeyOptionsResponse,
  PasskeySignInOptionsResponse,
  PasskeysResponse,
  TwoFactorRecoveryCodesResponse,
  TwoFactorRequiredResponse,
  TwoFactorSetupResponse,
  TwoFactorStatusResponse,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defined } from "../../test/defined.js";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "../../test/setup.js";
import { createSoftAuthenticator } from "../../test/softAuthenticator.js";
import { base32Decode, hotp, totpStep } from "../totp.js";

const PASSWORD = "test-pass-12";
/** In `CORS_ORIGINS` of the test config, so a page there may use passkeys. */
const ORIGIN = "http://localhost:5173";

describe("passkeys", () => {
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
    {
      as = token,
      origin = ORIGIN,
    }: { as?: string | null; origin?: string } = {},
  ) =>
    rig.request(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(as && { Authorization: `Bearer ${as}` }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  const login = (extra: object = {}) =>
    call(
      "POST",
      "/api/auth/login",
      { username: "alice", password: PASSWORD, ...extra },
      { as: null },
    );

  async function addPasskey(device = createSoftAuthenticator(ORIGIN)) {
    const started = await call("POST", "/api/auth/passkeys/options", {
      password: PASSWORD,
    });
    expect(started.status).toBe(200);
    const { options } = (await started.json()) as PasskeyOptionsResponse;
    const added = await call("POST", "/api/auth/passkeys", {
      name: "Laptop",
      response: device.create(options),
    });
    expect(added.status).toBe(201);
    return { device, added: (await added.json()) as PasskeyAddedResponse };
  }

  async function signInOptions() {
    const res = await call("POST", "/api/auth/passkey/options", undefined, {
      as: null,
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as PasskeySignInOptionsResponse).options;
  }

  const passkeyLogin = (response: unknown) =>
    call("POST", "/api/auth/passkey/login", { response }, { as: null });

  it("adds a passkey, which turns two-factor on with recovery codes", async () => {
    const { added } = await addPasskey();
    expect(added.passkey).toMatchObject({ name: "Laptop", synced: true });
    expect(added.recoveryCodes).toHaveLength(10);
    const listed = (await (
      await call("GET", "/api/auth/passkeys")
    ).json()) as PasskeysResponse;
    expect(listed.passkeys).toHaveLength(1);
    expect(listed.passkeys[0]).not.toHaveProperty("publicKey");
    const status = (await (
      await call("GET", "/api/auth/two-factor")
    ).json()) as TwoFactorStatusResponse;
    expect(status).toEqual({
      enabled: true,
      authenticator: false,
      recoveryCodesRemaining: 10,
    });
    // A second passkey shares the codes rather than replacing them.
    const second = await addPasskey();
    expect(second.added.recoveryCodes).toBeNull();
  });

  it("asks for the password before adding one", async () => {
    const res = await call("POST", "/api/auth/passkeys/options", {
      password: "wrong-password",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("password_incorrect");
  });

  it("takes a passkey as the second factor after the password", async () => {
    const { device } = await addPasskey();
    const asked = await login();
    expect(asked.status).toBe(403);
    const body = (await asked.json()) as TwoFactorRequiredResponse;
    expect(body.code).toBe("two_factor_required");
    expect(body.twoFactor?.authenticator).toBe(false);
    const options = body.twoFactor?.passkey;
    expect(options?.allowCredentials?.map((c) => c.id)).toEqual([
      device.credentialId,
    ]);
    const answer = device.get(options as NonNullable<typeof options>);
    expect((await login({ passkey: answer })).status).toBe(200);
    // Each challenge answers once.
    expect((await login({ passkey: answer })).status).toBe(401);
  });

  it("with PASSKEYS off, still asks for a passkey already added, and adds none", async () => {
    const { device } = await addPasskey();
    // As the next start with `PASSKEYS=off` would be.
    rig.cfg.passkeys = false;
    const asked = await login();
    expect(asked.status).toBe(403);
    const options = ((await asked.json()) as TwoFactorRequiredResponse)
      .twoFactor?.passkey;
    const answer = device.get(options as NonNullable<typeof options>);
    expect((await login({ passkey: answer })).status).toBe(200);
    expect(
      (
        await call("POST", "/api/auth/passkeys/options", {
          password: PASSWORD,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call("POST", "/api/auth/passkey/options", undefined, { as: null }))
        .status,
    ).toBe(404);
    // The account can still see and remove it.
    const listed = (await (
      await call("GET", "/api/auth/passkeys")
    ).json()) as PasskeysResponse;
    expect(listed.passkeys).toHaveLength(1);
  });

  it("offers no passkey challenge to a page elsewhere, whose passkeys are not these", async () => {
    await addPasskey();
    const res = await rig.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: PASSWORD }),
    });
    const body = (await res.json()) as TwoFactorRequiredResponse;
    expect(body.twoFactor?.passkey).toBeNull();
  });

  it("takes a recovery code when passkeys are the only second factor", async () => {
    const { added } = await addPasskey();
    const code = (added.recoveryCodes as string[])[0];
    expect((await login({ otp: code })).status).toBe(200);
    expect((await login({ otp: code })).status).toBe(401);
  });

  it("signs in with a passkey alone", async () => {
    const { device } = await addPasskey();
    const answer = device.get(await signInOptions());
    const res = await passkeyLogin(answer);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthSuccessResponse;
    expect(body.user.id).toBe(userId);
    expect(
      (await call("GET", "/api/notes", undefined, { as: body.token })).status,
    ).toBe(200);
    const stored = defined((await rig.storage.passkeys.listByUser(userId))[0]);
    expect(stored.counter).toBe(1);
    expect(stored.lastUsedAt).not.toBeNull();
    // Replayed, its challenge is spent.
    expect((await passkeyLogin(answer)).status).toBe(401);
  });

  it("wants the device to have checked its owner when a passkey is used alone", async () => {
    const { device } = await addPasskey();
    const answer = device.get(await signInOptions(), { verified: false });
    expect((await passkeyLogin(answer)).status).toBe(401);
  });

  it("does not take a second-factor challenge for a sign-in", async () => {
    const { device } = await addPasskey();
    const asked = (await (await login()).json()) as TwoFactorRequiredResponse;
    const answer = device.get(
      asked.twoFactor?.passkey as NonNullable<
        NonNullable<TwoFactorRequiredResponse["twoFactor"]>["passkey"]
      >,
    );
    expect((await passkeyLogin(answer)).status).toBe(401);
  });

  it("does not know a passkey it was never given", async () => {
    await addPasskey();
    const stranger = createSoftAuthenticator(ORIGIN);
    const options = await signInOptions();
    stranger.create({
      challenge: "x",
      rp: { name: "localhost", id: "localhost" },
      user: { id: "someone", name: "someone", displayName: "someone" },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }],
    });
    expect((await passkeyLogin(stranger.get(options))).status).toBe(401);
  });

  it("refuses a ceremony from a page this server does not serve", async () => {
    const res = await call("POST", "/api/auth/passkey/options", undefined, {
      as: null,
      origin: "https://evil.example",
    });
    expect(res.status).toBe(400);
  });

  it("turns two-factor off with the last passkey, and keeps the codes while one is left", async () => {
    const setup = (await (
      await call("POST", "/api/auth/two-factor/setup", { password: PASSWORD })
    ).json()) as TwoFactorSetupResponse;
    const enabled = (await (
      await call("POST", "/api/auth/two-factor/enable", {
        code: hotp(base32Decode(setup.secret), totpStep(Date.now()) - 1),
      })
    ).json()) as TwoFactorRecoveryCodesResponse;
    expect(enabled.recoveryCodes).toHaveLength(10);
    const { added } = await addPasskey();
    expect(added.recoveryCodes).toBeNull();

    // The authenticator goes; the passkey keeps two-factor on, codes and all.
    await call("POST", "/api/auth/two-factor/disable", { password: PASSWORD });
    let status = (await (
      await call("GET", "/api/auth/two-factor")
    ).json()) as TwoFactorStatusResponse;
    expect(status).toEqual({
      enabled: true,
      authenticator: false,
      recoveryCodesRemaining: 10,
    });

    const removed = await call(
      "DELETE",
      `/api/auth/passkeys/${added.passkey.id}`,
      { password: PASSWORD },
    );
    expect(removed.status).toBe(204);
    status = (await (
      await call("GET", "/api/auth/two-factor")
    ).json()) as TwoFactorStatusResponse;
    expect(status).toEqual({
      enabled: false,
      authenticator: false,
      recoveryCodesRemaining: 0,
    });
    expect((await login()).status).toBe(200);
  });

  it("is taken away by an admin's password reset, with the rest of two-factor", async () => {
    // Alice registered first, so she is the admin; Bob is the one reset.
    const bob = await registerTestUser(rig, "bob", PASSWORD);
    const started = await call(
      "POST",
      "/api/auth/passkeys/options",
      { password: PASSWORD },
      { as: bob.token },
    );
    const { options } = (await started.json()) as PasskeyOptionsResponse;
    const device = createSoftAuthenticator(ORIGIN);
    expect(
      (
        await call(
          "POST",
          "/api/auth/passkeys",
          { response: device.create(options) },
          { as: bob.token },
        )
      ).status,
    ).toBe(201);
    const reset = await rig.request(`/api/admin/users/${bob.userId}/password`, {
      method: "POST",
      headers: authHeaders(token),
    });
    expect(reset.status).toBe(200);
    expect(await rig.storage.passkeys.listByUser(bob.userId)).toEqual([]);
    expect((await passkeyLogin(device.get(await signInOptions()))).status).toBe(
      401,
    );
  });
});
