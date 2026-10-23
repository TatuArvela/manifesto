import {
  type AuthSuccessResponse,
  type DeviceSignInRequestResponse,
  type DeviceSignInStartedResponse,
  newDeviceRequestKeys,
  openOnDevice,
  wrapForDevice,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "#/app.ts";
import { createAuthProvider } from "#/auth/index.ts";
import { createStorage } from "#/storage/index.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { authHeaders, TEST_CONFIG } from "#/test/setup.ts";

const PASSWORD = "test-pass-12";
const SECRET_KEY = "SK-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ";

describe("sign-in of a new device by a QR code that it shows", () => {
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

  async function start(): Promise<DeviceSignInStartedResponse> {
    const res = await post(
      "/api/v1/auth/device-sign-in",
      {},
      { "User-Agent": "Firefox on a laptop" },
    );
    expect(res.status).toBe(200);
    return (await res.json()) as DeviceSignInStartedResponse;
  }

  const approve = (body: object, password: string | null = PASSWORD) =>
    post(
      "/api/v1/auth/device-sign-in/approve",
      password === null ? body : { ...body, password },
      authHeaders(session),
    );

  const wait = (waitToken: string) =>
    post("/api/v1/auth/device-sign-in/wait", { waitToken });

  beforeEach(async () => {
    await boot();
  });

  afterEach(async () => {
    await storage.close();
  });

  it("signs in the new device once it is approved, with the key wrapped to it", async () => {
    const keys = await newDeviceRequestKeys();
    const { id, waitToken } = await start();
    expect((await wait(waitToken)).status).toBe(202);

    const inspected = await post(
      "/api/v1/auth/device-sign-in/inspect",
      { id },
      authHeaders(session),
    );
    expect(inspected.status).toBe(200);
    expect(
      ((await inspected.json()) as DeviceSignInRequestResponse).userAgent,
    ).toBe("Firefox on a laptop");

    const key = await wrapForDevice(id, keys.publicKey, SECRET_KEY);
    expect((await approve({ id, key })).status).toBe(204);

    const done = await wait(waitToken);
    expect(done.status).toBe(200);
    const body = (await done.json()) as AuthSuccessResponse & {
      key: typeof key | null;
    };
    expect(body.user.username).toBe("alice");
    expect(body.token).not.toBe(session);
    expect(
      (await request("/api/v1/auth/me", { headers: authHeaders(body.token) }))
        .status,
    ).toBe(200);
    expect(body.key).not.toBeNull();
    expect(await openOnDevice(id, keys.privateKey, body.key ?? key)).toBe(
      SECRET_KEY,
    );
    // The wrap opens only for this request.
    expect(
      await openOnDevice("0".repeat(64), keys.privateKey, body.key ?? key),
    ).toBeNull();

    // Used once.
    expect((await wait(waitToken)).status).toBe(410);
    const entries = await storage.audit.list({ limit: 20 });
    expect(
      entries.some((e) => e.action === "auth.device_sign_in_approved"),
    ).toBe(true);
    expect(
      entries.some(
        (e) => e.action === "auth.signed_in" && e.detail.method === "device",
      ),
    ).toBe(true);
  });

  it("signs in without a key when the approving device has none", async () => {
    const { id, waitToken } = await start();
    expect((await approve({ id })).status).toBe(204);
    const done = await wait(waitToken);
    expect(done.status).toBe(200);
    expect(((await done.json()) as { key: unknown }).key).toBeNull();
  });

  it("asks for the password before it approves", async () => {
    const { id, waitToken } = await start();
    const none = await approve({ id }, null);
    expect(none.status).toBe(403);
    expect(((await none.json()) as { code: string }).code).toBe(
      "confirmation_required",
    );
    const wrong = await approve({ id }, "not-the-password");
    expect(((await wrong.json()) as { code: string }).code).toBe(
      "password_incorrect",
    );
    expect((await wait(waitToken)).status).toBe(202);
  });

  it("approves a request only once, and never with the wait token", async () => {
    const { id, waitToken } = await start();
    expect((await approve({ id: waitToken })).status).toBe(410);
    expect((await approve({ id })).status).toBe(204);
    expect((await approve({ id })).status).toBe(410);
    expect(
      (
        await post(
          "/api/v1/auth/device-sign-in/inspect",
          { id },
          authHeaders(session),
        )
      ).status,
    ).toBe(410);
  });

  it("gives the session only to the wait token, never to the id in the code", async () => {
    const { id } = await start();
    expect((await approve({ id })).status).toBe(204);
    expect((await wait(id)).status).toBe(410);
  });

  it("needs a session to read or approve a request", async () => {
    const { id } = await start();
    expect(
      (await post("/api/v1/auth/device-sign-in/inspect", { id })).status,
    ).toBe(401);
    expect(
      (await post("/api/v1/auth/device-sign-in/approve", { id })).status,
    ).toBe(401);
  });

  it("forgets an approval that was not collected when the sessions end", async () => {
    const { id, waitToken } = await start();
    expect((await approve({ id })).status).toBe(204);
    expect(
      (
        await post(
          "/api/v1/auth/password",
          { currentPassword: PASSWORD, newPassword: "other-pass-34" },
          authHeaders(session),
        )
      ).status,
    ).toBe(204);
    expect((await wait(waitToken)).status).toBe(410);
  });

  it("refuses an expired request", async () => {
    const { id, waitToken } = await start();
    await storage.deviceSignIns.deleteExpired("2999-01-01T00:00:00.000Z");
    expect((await approve({ id })).status).toBe(410);
    expect((await wait(waitToken)).status).toBe(410);
  });
});

describe("sign-in of a new device, switched off", () => {
  it("is not there with DEVICE_SIGN_IN off", async () => {
    const config = { ...TEST_CONFIG, deviceSignIn: false };
    const storage = await createStorage(config);
    const { app } = createApp({
      cfg: config,
      storage,
      authProvider: createAuthProvider(config, storage),
    });
    const res = await app.request("/api/v1/auth/device-sign-in", {
      method: "POST",
    });
    const caps = await (await app.request("/api/v1/capabilities")).json();
    await storage.close();
    expect(res.status).toBe(404);
    expect(caps.features.deviceSignIn).toBe(false);
  });
});
