import type { AuditLogResponse } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  bootTestAppWith,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";

describe("audit log", () => {
  let rig: TestRig;
  let admin: { token: string; userId: string };
  let bob: { token: string; userId: string };

  /** Audit writes are fire-and-forget; one turn lets them land. */
  const settle = () => new Promise((r) => setTimeout(r, 20));

  beforeEach(async () => {
    rig = await bootTestApp();
    admin = await registerTestUser(rig, "alice");
    bob = await registerTestUser(rig, "bob");
  });

  afterEach(async () => {
    await settle();
    await rig.close();
  });

  const login = (username: string, password: string) =>
    rig.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

  async function log(query = "") {
    await settle();
    const res = await rig.request(`/api/admin/audit${query}`, {
      headers: authHeaders(admin.token),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as AuditLogResponse;
  }

  it("records sign-ins, failed ones, and admin grants, newest first", async () => {
    await login("bob", "wrong-pass-00");
    await login("bob", "test-pass-12");
    await rig.request(`/api/admin/users/${bob.userId}`, {
      method: "PUT",
      headers: authHeaders(admin.token),
      body: JSON.stringify({ isAdmin: true }),
    });
    const { entries } = await log();
    expect(entries.slice(0, 3).map((e) => e.action)).toEqual([
      "admin.admin_granted",
      "auth.signed_in",
      "auth.sign_in_failed",
    ]);
    expect(entries[0].actor?.username).toBe("alice");
    expect(entries[0].target?.username).toBe("bob");
    expect(entries[2].detail).toEqual({ username: "bob", reason: "password" });
  });

  it("narrows to one account, one action, and pages", async () => {
    for (let i = 0; i < 3; i++) await login("bob", "wrong-pass-00");
    await login("alice", "wrong-pass-00");
    const bobs = await log(`?userId=${bob.userId}&action=auth.sign_in_failed`);
    expect(bobs.entries).toHaveLength(3);
    const first = await log(
      `?userId=${bob.userId}&action=auth.sign_in_failed&limit=2`,
    );
    expect(first.entries).toHaveLength(2);
    expect(first.nextBefore).not.toBeNull();
    const rest = await log(
      `?userId=${bob.userId}&action=auth.sign_in_failed&limit=2&before=${first.nextBefore}`,
    );
    expect(rest.entries).toHaveLength(1);
    expect(rest.nextBefore).toBeNull();
  });

  it("is for admins only", async () => {
    const res = await rig.request("/api/admin/audit", {
      headers: authHeaders(bob.token),
    });
    expect(res.status).toBe(403);
  });

  async function activity(token: string) {
    await settle();
    const res = await rig.request("/api/auth/me/activity", {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as AuditLogResponse;
  }

  /** A rig that records addresses, which the test app has no socket for. */
  async function withAddresses() {
    await rig.close();
    rig = await bootTestAppWith({ trustProxy: true });
    admin = await registerTestUser(rig, "alice");
    bob = await registerTestUser(rig, "bob");
  }

  const from = (ip: string) => ({ "X-Forwarded-For": ip });

  it("shows a user their own activity, and nobody else's", async () => {
    await withAddresses();
    await rig.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...from("198.51.100.7") },
      body: JSON.stringify({ username: "bob", password: "wrong-pass-00" }),
    });
    await login("alice", "wrong-pass-00");
    const { entries } = await activity(bob.token);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect([entry.actor?.id, entry.target?.id]).toContain(bob.userId);
    }
    const failed = entries.find((e) => e.action === "auth.sign_in_failed");
    // Nobody was signed in, so the address is the one it was tried from.
    expect(failed?.ip).toBe("198.51.100.7");
  });

  it("tells a user what an admin did to their account, but not from where", async () => {
    await withAddresses();
    await rig.request(`/api/admin/users/${bob.userId}`, {
      method: "PUT",
      headers: { ...authHeaders(admin.token), ...from("203.0.113.9") },
      body: JSON.stringify({ isAdmin: true }),
    });
    const { entries } = await activity(bob.token);
    const granted = entries.find((e) => e.action === "admin.admin_granted");
    expect(granted?.actor?.username).toBe("alice");
    expect(granted?.ip).toBeNull();
    const all = await log(`?userId=${bob.userId}&action=admin.admin_granted`);
    expect(all.entries[0].ip).toBe("203.0.113.9");
  });

  it("will not give a user's activity to an API token", async () => {
    const created = await rig.request("/api/tokens", {
      method: "POST",
      headers: authHeaders(bob.token),
      body: JSON.stringify({ name: "script" }),
    });
    const { secret } = (await created.json()) as { secret: string };
    const res = await rig.request("/api/auth/me/activity", {
      headers: authHeaders(secret),
    });
    expect(res.status).toBe(403);
  });

  it("forgets entries past the retention", async () => {
    await login("bob", "wrong-pass-00");
    await settle();
    expect(
      await rig.storage.audit.deleteBefore("2999-01-01T00:00:00.000Z"),
    ).toBeGreaterThan(0);
    expect((await log()).entries).toEqual([]);
  });

  it("gives an admin the overview of what the server holds", async () => {
    const res = await rig.request("/api/admin/overview", {
      headers: authHeaders(admin.token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals.users).toBe(2);
    expect(
      body.perUser
        .map((r: { user: { username: string } }) => r.user.username)
        .sort(),
    ).toEqual(["alice", "bob"]);
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(typeof body.version).toBe("string");
  });

  it("says whether a newer release is out, as far as it knows", async () => {
    const res = await rig.request("/api/admin/update", {
      headers: authHeaders(admin.token),
    });
    expect(await res.json()).toMatchObject({ update: null });
  });
});
