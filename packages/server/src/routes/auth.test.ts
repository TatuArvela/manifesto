import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootTestApp, registerTestUser, type TestRig } from "../test/setup.js";

describe("auth routes", () => {
  let rig: TestRig;

  beforeEach(() => {
    rig = bootTestApp();
  });

  afterEach(() => {
    rig.db.close();
  });

  it("registers a user and returns a session token", async () => {
    const res = await rig.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "test-pass-12" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      token: string;
      user: { username: string; displayName: string };
    };
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.user.username).toBe("alice");
    expect(body.user.displayName).toBe("alice");
  });

  it("rejects duplicate usernames with 409", async () => {
    await registerTestUser(rig, "alice");
    const res = await rig.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "ALICE", password: "test-pass-12" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Username is already taken" });
  });

  it("rejects short passwords with 422", async () => {
    const res = await rig.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "x" }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Password");
  });

  it("logs in with valid credentials", async () => {
    await registerTestUser(rig, "alice", "password-1234");
    const res = await rig.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "password-1234" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects invalid passwords with 401 and the same generic message", async () => {
    await registerTestUser(rig, "alice", "password-1234");
    const res = await rig.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "password-9999" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Invalid username or password",
    });
  });

  it("rejects unknown usernames with the same generic 401", async () => {
    const res = await rig.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "ghost", password: "password-1234" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Invalid username or password",
    });
  });

  it("logs out and invalidates the session token", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const out = await rig.request("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(out.status).toBe(204);

    const after = await rig.request("/api/notes", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });

  it("rejects logout without a token", async () => {
    const res = await rig.request("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(401);
  });
});
