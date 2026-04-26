import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootTestApp, registerTestUser, type TestRig } from "../test/setup.js";

describe("auth shared routes", () => {
  let rig: TestRig;

  beforeEach(async () => {
    rig = await bootTestApp();
  });

  afterEach(async () => {
    await rig.close();
  });

  it("GET /api/auth/methods returns the configured provider name", async () => {
    const res = await rig.request("/api/auth/methods");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ provider: "local" });
  });

  it("GET /api/auth/methods is public (no auth required)", async () => {
    const res = await rig.request("/api/auth/methods");
    expect(res.status).toBe(200);
  });

  it("GET /api/auth/me returns the current user for a valid token", async () => {
    const { token, userId } = await registerTestUser(rig, "alice");
    const res = await rig.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string; username: string; displayName: string };
    };
    expect(body.user.id).toBe(userId);
    expect(body.user.username).toBe("alice");
    expect(body.user.displayName).toBe("alice");
  });

  it("GET /api/auth/me returns 401 without a bearer token", async () => {
    const res = await rig.request("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("GET /api/auth/me returns 401 with a bogus bearer token", async () => {
    const res = await rig.request("/api/auth/me", {
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    expect(res.status).toBe(401);
  });
});
