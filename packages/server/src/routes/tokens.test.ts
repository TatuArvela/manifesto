import type {
  ApiTokenCreatedResponse,
  ApiTokensResponse,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashToken } from "../lib/token.js";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";

describe("API tokens", () => {
  let rig: TestRig;
  let session: string;

  beforeEach(async () => {
    rig = await bootTestApp();
    ({ token: session } = await registerTestUser(rig, "alice"));
  });

  afterEach(async () => {
    await rig.close();
  });

  const call = (token: string, method: string, path: string, body?: unknown) =>
    rig.request(path, {
      method,
      headers: authHeaders(token),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  async function mint(body: object = { name: "script" }) {
    const res = await call(session, "POST", "/api/tokens", body);
    expect(res.status).toBe(201);
    return (await res.json()) as ApiTokenCreatedResponse;
  }

  it("mints a token that reads and writes notes", async () => {
    const { secret, token } = await mint();
    expect(secret.startsWith("mfp_")).toBe(true);
    expect(secret.startsWith(token.prefix)).toBe(true);
    expect((await call(secret, "GET", "/api/notes")).status).toBe(200);
    expect((await call(secret, "GET", "/api/auth/me")).status).toBe(200);
  });

  it("lists tokens without their secrets, with when each was last used", async () => {
    const { secret } = await mint();
    await call(secret, "GET", "/api/notes");
    const res = await call(session, "GET", "/api/tokens");
    const { tokens } = (await res.json()) as ApiTokensResponse;
    expect(tokens).toHaveLength(1);
    expect(JSON.stringify(tokens)).not.toContain(secret);
    expect(tokens[0].lastUsedAt).not.toBeNull();
  });

  it("keeps a token away from the account's own security", async () => {
    const { secret } = await mint();
    expect((await call(secret, "GET", "/api/tokens")).status).toBe(403);
    expect(
      (await call(secret, "POST", "/api/tokens", { name: "more" })).status,
    ).toBe(403);
    expect(
      (
        await call(secret, "POST", "/api/auth/password", {
          currentPassword: "test-pass-12",
          newPassword: "another-pass-34",
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(secret, "PUT", "/api/auth/me", { email: "a@b.c" })).status,
    ).toBe(403);
    // Alice is the first account, and so an admin.
    expect((await call(secret, "GET", "/api/admin/users")).status).toBe(403);
  });

  it("stops working once revoked, and only its owner can revoke it", async () => {
    const { secret, token } = await mint();
    const { token: bob } = await registerTestUser(rig, "bob");
    expect((await call(bob, "DELETE", `/api/tokens/${token.id}`)).status).toBe(
      404,
    );
    expect(
      (await call(session, "DELETE", `/api/tokens/${token.id}`)).status,
    ).toBe(204);
    expect((await call(secret, "GET", "/api/notes")).status).toBe(401);
  });

  it("stops working when it expires, and the sweep removes it", async () => {
    const { token } = await mint({ name: "brief", expiresInDays: 1 });
    expect(token.expiresAt).not.toBeNull();
    const { userId } = await registerTestUser(rig, "carol");
    await rig.storage.apiTokens.create({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      userId,
      name: "old",
      prefix: "mfp_old",
      createdAt: "2020-01-01T00:00:00.000Z",
      lastUsedAt: null,
      expiresAt: "2020-01-02T00:00:00.000Z",
      tokenHash: hashToken("mfp_old-secret"),
    });
    expect((await call("mfp_old-secret", "GET", "/api/notes")).status).toBe(
      401,
    );
    expect(
      await rig.storage.apiTokens.deleteExpired(new Date().toISOString()),
    ).toBe(1);
  });

  it("ends with the password, since whoever knew it could have minted one", async () => {
    const { secret } = await mint();
    const res = await call(session, "POST", "/api/auth/password", {
      currentPassword: "test-pass-12",
      newPassword: "another-pass-34",
    });
    expect(res.status).toBe(204);
    expect((await call(secret, "GET", "/api/notes")).status).toBe(401);
    expect((await call(session, "GET", "/api/notes")).status).toBe(200);
  });

  it("refuses a nameless token", async () => {
    expect(
      (await call(session, "POST", "/api/tokens", { name: " " })).status,
    ).toBe(422);
  });
});
