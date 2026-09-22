import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import {
  authHeaders,
  bootTestApp,
  bootTestAppWith,
  registerTestUser,
  type TestRig,
} from "../../test/setup.js";
import { issueSession } from "../session.js";
import { MAX_LOGIN_FAILURES } from "./loginAttempts.js";

// Spied, not replaced: these tests ask how many argon2 operations a request
// spent, which is the whole of what separates a known username from an
// unknown one.
vi.mock("../../lib/password.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/password.js")>(
    "../../lib/password.js",
  );
  return {
    hashPassword: vi.fn(actual.hashPassword),
    verifyPassword: vi.fn(actual.verifyPassword),
  };
});

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

  describe("what a wrong sign-in costs", () => {
    function login(username: string, password = "password-1234") {
      return rig.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
    }

    it("verifies against a decoy when the username is nobody's", async () => {
      vi.mocked(verifyPassword).mockClear();
      expect((await login("ghost")).status).toBe(401);
      // Without this the miss returns in about a millisecond while a hit
      // pays a ~50 ms verify, and the gap reports which accounts exist.
      expect(verifyPassword).toHaveBeenCalledTimes(1);
    });

    it("verifies against a decoy for an account that has no password", async () => {
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
      vi.mocked(verifyPassword).mockClear();
      expect((await login("sso-user")).status).toBe(401);
      expect(verifyPassword).toHaveBeenCalledTimes(1);
    });

    it("builds the decoy once and keeps it", async () => {
      vi.mocked(hashPassword).mockClear();
      await login("ghost-one");
      await login("ghost-two");
      expect(hashPassword).toHaveBeenCalledTimes(1);
      // From the server's own parameters, so it tracks an ARGON2_* override
      // instead of freezing a cost of its own.
      expect(hashPassword).toHaveBeenCalledWith(expect.any(String), rig.cfg);
    });
  });

  describe("failed sign-ins per account", () => {
    let proxied: TestRig;

    beforeEach(async () => {
      proxied = await bootTestAppWith({ trustProxy: true });
    });

    afterEach(async () => {
      await proxied.close();
    });

    // Every attempt comes from a /64 of its own, so the per-IP throttle never
    // sees the same client twice and only the per-account count can stop it.
    // That is the attacker this counter is for: the per-IP budget is renewed
    // by moving, and `admin` is a name every local-auth server has.
    function attempt(username: string, password: string, n: number) {
      return proxied.request("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `2001:db8:0:${n.toString(16)}::1`,
        },
        body: JSON.stringify({ username, password }),
      });
    }

    it("stops asking after enough failures, wherever they came from", async () => {
      await registerTestUser(proxied, "alice", "password-1234");
      for (let i = 0; i < MAX_LOGIN_FAILURES; i++) {
        expect((await attempt("alice", "wrong-password", i)).status).toBe(401);
      }
      const locked = await attempt("alice", "wrong-password", 900);
      expect(locked.status).toBe(429);
      expect(locked.headers.get("Retry-After")).toMatch(/^\d+$/);
      // The lock is on the account, so the right password waits as well.
      expect((await attempt("alice", "password-1234", 901)).status).toBe(429);
    });

    it("locks a username nobody holds on the same budget", async () => {
      // Otherwise the lock itself would answer what the 401 will not: an
      // account that can be locked is an account that exists.
      for (let i = 0; i < MAX_LOGIN_FAILURES; i++) {
        expect((await attempt("ghost", "wrong-password", i)).status).toBe(401);
      }
      expect((await attempt("ghost", "wrong-password", 900)).status).toBe(429);
    });

    it("leaves every other account alone", async () => {
      await registerTestUser(proxied, "alice", "password-1234");
      await registerTestUser(proxied, "bob", "password-5678");
      for (let i = 0; i < MAX_LOGIN_FAILURES; i++) {
        await attempt("alice", "wrong-password", i);
      }
      expect((await attempt("alice", "password-1234", 900)).status).toBe(429);
      expect((await attempt("bob", "password-5678", 901)).status).toBe(200);
    });

    it("forgets the failures once a password is right", async () => {
      await registerTestUser(proxied, "alice", "password-1234");
      for (let i = 0; i < MAX_LOGIN_FAILURES - 1; i++) {
        expect((await attempt("alice", "wrong-password", i)).status).toBe(401);
      }
      expect((await attempt("alice", "password-1234", 900)).status).toBe(200);
      // The budget starts over, so these two are the first and second of a
      // fresh ten rather than the tenth and a refusal.
      expect((await attempt("alice", "wrong-password", 901)).status).toBe(401);
      expect((await attempt("alice", "wrong-password", 902)).status).toBe(401);
    });
  });
});
