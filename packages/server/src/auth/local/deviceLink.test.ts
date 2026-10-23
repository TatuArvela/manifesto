import type {
  AuthSuccessResponse,
  DeviceLinkResponse,
  TwoFactorSetupResponse,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "#/app.ts";
import { createAuthProvider } from "#/auth/index.ts";
import { base32Decode, hotp, totpStep } from "#/auth/totp.ts";
import { createStorage } from "#/storage/index.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { authHeaders, TEST_CONFIG } from "#/test/setup.ts";

const PASSWORD = "test-pass-12";

describe("sign-in of a second device by a QR code", () => {
  let storage: StorageDriver;
  let request: (path: string, init?: RequestInit) => Promise<Response>;
  let session: string;

  const post = (path: string, body: unknown, headers: HeadersInit = {}) =>
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  async function boot(config = TEST_CONFIG) {
    storage = await createStorage(config);
    const { app } = createApp({
      cfg: config,
      storage,
      authProvider: createAuthProvider(config, storage),
    });
    request = async (path, init) => app.request(path, init);
    const res = await post("/api/v1/auth/register", {
      username: "alice",
      password: PASSWORD,
    });
    expect(res.status).toBe(201);
    session = ((await res.json()) as AuthSuccessResponse).token;
  }

  const make = (password: string | null = PASSWORD) =>
    post(
      "/api/v1/auth/device-link",
      password === null ? {} : { password },
      authHeaders(session),
    );

  async function deviceToken(): Promise<string> {
    const res = await make();
    expect(res.status).toBe(200);
    return ((await res.json()) as DeviceLinkResponse).token;
  }

  const confirm = (token: string, extra: object = {}) =>
    post("/api/v1/auth/device-link/confirm", { token, ...extra });

  beforeEach(async () => {
    await boot();
  });

  afterEach(async () => {
    await storage.close();
  });

  it("makes a code that signs in one device once, and keeps the first session", async () => {
    const res = await make();
    expect(res.status).toBe(200);
    const { token, expiresAt } = (await res.json()) as DeviceLinkResponse;
    const minutes = (Date.parse(expiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(4);
    expect(minutes).toBeLessThanOrEqual(5);

    const first = await confirm(token);
    expect(first.status).toBe(200);
    const body = (await first.json()) as AuthSuccessResponse;
    expect(body.user.username).toBe("alice");
    expect(body.token).not.toBe(session);
    expect(
      (await request("/api/v1/auth/me", { headers: authHeaders(body.token) }))
        .status,
    ).toBe(200);
    expect((await confirm(token)).status).toBe(410);
    expect(
      (await request("/api/v1/auth/me", { headers: authHeaders(session) }))
        .status,
    ).toBe(200);

    const entries = await storage.audit.list({ limit: 20 });
    expect(entries.some((e) => e.action === "auth.device_link_created")).toBe(
      true,
    );
    expect(
      entries.some(
        (e) => e.action === "auth.signed_in" && e.detail.method === "device",
      ),
    ).toBe(true);
  });

  it("asks for the password first, and refuses a wrong one", async () => {
    const none = await make(null);
    expect(none.status).toBe(403);
    expect(((await none.json()) as { code: string }).code).toBe(
      "confirmation_required",
    );
    const wrong = await make("not-the-password");
    expect(wrong.status).toBe(403);
    expect(((await wrong.json()) as { code: string }).code).toBe(
      "password_incorrect",
    );
  });

  it("refuses a request with no session", async () => {
    const res = await post("/api/v1/auth/device-link", { password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it("refuses a made-up token and an expired one", async () => {
    expect((await confirm("f".repeat(64))).status).toBe(410);
    const token = await deviceToken();
    await storage.deviceLinks.deleteExpired("2999-01-01T00:00:00.000Z");
    expect((await confirm(token)).status).toBe(410);
  });

  it("refuses a code made before the password was changed", async () => {
    const token = await deviceToken();
    expect(
      (
        await post(
          "/api/v1/auth/password",
          { currentPassword: PASSWORD, newPassword: "other-pass-34" },
          authHeaders(session),
        )
      ).status,
    ).toBe(204);
    expect((await confirm(token)).status).toBe(410);
  });

  it("still asks the second device for the second factor", async () => {
    const setup = await post(
      "/api/v1/auth/two-factor/setup",
      { password: PASSWORD },
      authHeaders(session),
    );
    const { secret } = (await setup.json()) as TwoFactorSetupResponse;
    const codeAt = (offset: number) =>
      hotp(base32Decode(secret), totpStep(Date.now()) + offset);
    expect(
      (
        await post(
          "/api/v1/auth/two-factor/enable",
          { code: codeAt(-1) },
          authHeaders(session),
        )
      ).status,
    ).toBe(204);

    const token = await deviceToken();
    const asked = await confirm(token);
    expect(asked.status).toBe(403);
    expect(((await asked.json()) as { code: string }).code).toBe(
      "two_factor_required",
    );
    expect((await confirm(token, { otp: "000000" })).status).toBe(401);
    expect((await confirm(token, { otp: codeAt(0) })).status).toBe(200);
    expect((await confirm(token, { otp: codeAt(1) })).status).toBe(410);
  });
});

describe("sign-in of a second device, switched off", () => {
  it("is not there, and not offered, with DEVICE_LINKS off", async () => {
    const config = { ...TEST_CONFIG, deviceLinks: false };
    const storage = await createStorage(config);
    const { app } = createApp({
      cfg: config,
      storage,
      authProvider: createAuthProvider(config, storage),
    });
    const res = await app.request("/api/v1/auth/device-link/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "x" }),
    });
    const caps = await (await app.request("/api/v1/capabilities")).json();
    await storage.close();
    expect(res.status).toBe(404);
    expect(caps.auth.deviceLink).toBe(false);
  });
});
