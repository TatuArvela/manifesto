import type { AuditLogResponse } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "#/test/setup.ts";

describe("DELETE /api/v1/auth/me", () => {
  let rig: TestRig;
  let admin: { token: string; userId: string };
  let bob: { token: string; userId: string };

  /** Audit writes do not wait. One turn lets them complete. */
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

  const deleteMe = (token: string, password?: string) =>
    rig.request("/api/v1/auth/me", {
      method: "DELETE",
      headers: authHeaders(token),
      body: JSON.stringify(password === undefined ? {} : { password }),
    });

  it("asks for the password first", async () => {
    expect((await deleteMe(bob.token)).status).toBe(403);
    expect((await deleteMe(bob.token, "wrong-pass-00")).status).toBe(403);
    expect(await rig.storage.users.findById(bob.userId)).not.toBeNull();
  });

  it("deletes the account, ends its sessions and frees the name", async () => {
    expect((await deleteMe(bob.token, "test-pass-12")).status).toBe(204);
    expect(await rig.storage.users.findById(bob.userId)).toBeNull();
    const me = await rig.request("/api/v1/auth/me", {
      headers: authHeaders(bob.token),
    });
    expect(me.status).toBe(401);
    await registerTestUser(rig, "bob");
  });

  it("is recorded in the audit log", async () => {
    await deleteMe(bob.token, "test-pass-12");
    await settle();
    const res = await rig.request(
      "/api/v1/admin/audit?action=auth.account_deleted",
      { headers: authHeaders(admin.token) },
    );
    const { entries } = (await res.json()) as AuditLogResponse;
    expect(entries).toHaveLength(1);
  });

  it("refuses the last admin", async () => {
    expect((await deleteMe(admin.token, "test-pass-12")).status).toBe(409);
    expect(await rig.storage.users.findById(admin.userId)).not.toBeNull();
  });
});
