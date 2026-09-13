import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  bootTestAppWith,
  registerTestUser,
  type TestRig,
} from "../../test/setup.js";
import { issueSession } from "../session.js";

describe("local auth router", () => {
  let rig: TestRig;

  beforeEach(async () => {
    rig = await bootTestApp();
  });

  afterEach(async () => {
    await rig.close();
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

  it("rejects login for SSO-only accounts (no password set)", async () => {
    await rig.storage.users.create({
      id: "sso-1",
      username: "sso-user",
      passwordHash: null,
      displayName: "",
      avatarColor: "",
      provider: "oidc:example",
      externalId: "sub-1",
      createdAt: new Date().toISOString(),
    });
    const res = await rig.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "sso-user", password: "anything-12" }),
    });
    expect(res.status).toBe(401);
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

  it("returns 403 from /register when REGISTRATION_ENABLED is false", async () => {
    const closedRig = await bootTestAppWith({ registrationEnabled: false });
    try {
      const res = await closedRig.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "test-pass-12" }),
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Registration is disabled" });
      expect(await closedRig.storage.users.findByUsername("alice")).toBeNull();
    } finally {
      await closedRig.close();
    }
  });

  it("tells the first account it is the admin, and no later one", async () => {
    const register = async (username: string) => {
      const res = await rig.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: "test-pass-12" }),
      });
      return ((await res.json()) as { user: { isAdmin: boolean } }).user;
    };
    expect((await register("alice")).isAdmin).toBe(true);
    expect((await register("bob")).isAdmin).toBe(false);
  });

  describe("changing your own password", () => {
    function change(token: string, body: unknown) {
      return rig.request("/api/auth/password", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify(body),
      });
    }

    async function signIn(password: string): Promise<Response> {
      return rig.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "alice", password }),
      });
    }

    it("replaces the password and ends every other session", async () => {
      const { token: elsewhere } = await registerTestUser(
        rig,
        "alice",
        "old-password-1",
      );
      const here = (
        (await (await signIn("old-password-1")).json()) as {
          token: string;
        }
      ).token;

      const res = await change(here, {
        currentPassword: "old-password-1",
        newPassword: "new-password-2",
      });
      expect(res.status).toBe(204);

      const notes = (token: string) =>
        rig.request("/api/notes", { headers: authHeaders(token) });
      expect((await notes(elsewhere)).status).toBe(401);
      expect((await notes(here)).status).toBe(200);
      expect((await signIn("old-password-1")).status).toBe(401);
      expect((await signIn("new-password-2")).status).toBe(200);
    });

    it("refuses a wrong current password without signing the caller out", async () => {
      const { token } = await registerTestUser(rig, "alice", "old-password-1");
      const res = await change(token, {
        currentPassword: "not-it-at-all",
        newPassword: "new-password-2",
      });
      // Not 401, which a client reads as a dead session.
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "Current password is incorrect",
      });
    });

    it("refuses a new password that is the current one, or too short", async () => {
      const { token } = await registerTestUser(rig, "alice", "old-password-1");
      expect(
        (
          await change(token, {
            currentPassword: "old-password-1",
            newPassword: "old-password-1",
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await change(token, {
            currentPassword: "old-password-1",
            newPassword: "short",
          })
        ).status,
      ).toBe(422);
    });

    it("refuses an account that has no password to change", async () => {
      await registerTestUser(rig, "alice");
      const sso = await rig.storage.users.create({
        id: "sso-1",
        username: "sso-user",
        passwordHash: null,
        displayName: "",
        avatarColor: "",
        provider: "oidc:example",
        externalId: "sub-1",
        createdAt: new Date().toISOString(),
      });
      const { token } = await issueSession(rig.storage, rig.cfg, sso.id);
      const res = await change(token, {
        currentPassword: "anything-at-all",
        newPassword: "new-password-2",
      });
      expect(res.status).toBe(409);
    });
  });
});
