import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  bootTestAppWith,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";
import {
  announceInitialAdmin,
  ensureInitialAdmin,
  INITIAL_ADMIN_USERNAME,
} from "./initialAdmin.js";

function signIn(
  rig: TestRig,
  body: { username: string; password: string; newPassword?: string },
): Promise<Response> {
  return rig.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("ensureInitialAdmin", () => {
  let rig: TestRig;

  beforeEach(async () => {
    rig = await bootTestApp();
  });

  afterEach(async () => {
    await rig.close();
  });

  it("gives a new server an admin whose temporary password must be replaced", async () => {
    const issued = await ensureInitialAdmin(rig.storage, rig.cfg);
    expect(issued).toMatchObject({
      username: INITIAL_ADMIN_USERNAME,
      created: true,
      fromConfig: false,
    });
    expect(issued?.password).toMatch(/^([a-z2-9]{4}-){3}[a-z2-9]{4}$/);
    const admin = await rig.storage.users.findByUsername("admin");
    expect(admin).toMatchObject({ isAdmin: true, mustChangePassword: true });

    const password = issued?.password ?? "";
    const blocked = await signIn(rig, { username: "admin", password });
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { code: string }).code).toBe(
      "password_change_required",
    );
    const claimed = await signIn(rig, {
      username: "admin",
      password,
      newPassword: "operators-own-pass",
    });
    expect(claimed.status).toBe(200);
  });

  it("means the first account to register is no longer the admin", async () => {
    await ensureInitialAdmin(rig.storage, rig.cfg);
    const { token } = await registerTestUser(rig, "early-bird");
    const me = await rig.request("/api/auth/me", {
      headers: authHeaders(token),
    });
    expect(
      ((await me.json()) as { user: { isAdmin: boolean } }).user.isAdmin,
    ).toBe(false);
  });

  it("issues a fresh password on each boot until the account is claimed", async () => {
    const first = await ensureInitialAdmin(rig.storage, rig.cfg);
    const second = await ensureInitialAdmin(rig.storage, rig.cfg);
    expect(second).toMatchObject({ username: "admin", created: false });
    expect(second?.password).not.toBe(first?.password);
    expect((await rig.storage.users.listAdmins()).length).toBe(1);

    // The lost password no longer works; the new one does.
    expect(
      (
        await signIn(rig, {
          username: "admin",
          password: first?.password ?? "",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await signIn(rig, {
          username: "admin",
          password: second?.password ?? "",
        })
      ).status,
    ).toBe(403);
  });

  it("does nothing once the admin has chosen a password", async () => {
    const issued = await ensureInitialAdmin(rig.storage, rig.cfg);
    await signIn(rig, {
      username: "admin",
      password: issued?.password ?? "",
      newPassword: "operators-own-pass",
    });
    expect(await ensureInitialAdmin(rig.storage, rig.cfg)).toBeNull();
    expect(
      (
        await signIn(rig, {
          username: "admin",
          password: "operators-own-pass",
        })
      ).status,
    ).toBe(200);
  });

  it("does nothing for a server that already has an admin", async () => {
    // What an upgraded server looks like: the migration promoted the oldest
    // account, which has a password of its own.
    await registerTestUser(rig, "existing");
    expect(await ensureInitialAdmin(rig.storage, rig.cfg)).toBeNull();
    expect(await rig.storage.users.findByUsername("admin")).toBeNull();
  });

  it("leaves someone else's account named admin alone", async () => {
    // A server whose only admin signs in through an identity provider it no
    // longer uses, with a local user who happens to be called admin.
    await rig.storage.users.create({
      id: "sso-admin",
      username: "sso-person",
      passwordHash: null,
      displayName: "",
      avatarColor: "",
      provider: "oidc:https://idp.example.com",
      externalId: "sub-1",
      createdAt: new Date().toISOString(),
    });
    const { userId } = await registerTestUser(rig, "admin", "their-own-pass");

    const issued = await ensureInitialAdmin(rig.storage, rig.cfg);
    expect(issued?.username).toMatch(/^admin-[0-9a-z]{6}$/);
    expect(await rig.storage.users.findById(userId)).toMatchObject({
      isAdmin: false,
      mustChangePassword: false,
    });
  });

  it("uses INITIAL_ADMIN_PASSWORD when set, and still asks for a change", async () => {
    const preset = await bootTestAppWith({
      initialAdminPassword: "preset-password-1",
    });
    try {
      const issued = await ensureInitialAdmin(preset.storage, preset.cfg);
      expect(issued).toMatchObject({
        password: "preset-password-1",
        fromConfig: true,
      });
      const res = await signIn(preset, {
        username: "admin",
        password: "preset-password-1",
      });
      expect(res.status).toBe(403);
    } finally {
      await preset.close();
    }
  });

  it("leaves a single sign-on server to its first sign-in", async () => {
    expect(
      await ensureInitialAdmin(rig.storage, {
        ...rig.cfg,
        authProvider: "oidc",
      }),
    ).toBeNull();
    expect(await rig.storage.users.listAdmins()).toEqual([]);
  });
});

describe("announceInitialAdmin", () => {
  it("prints the generated password as a log line", () => {
    const lines: string[] = [];
    announceInitialAdmin(
      {
        username: "admin",
        password: "abcd-efgh-jkmn-pqrs",
        created: true,
        fromConfig: false,
      },
      (line) => lines.push(line),
    );
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      level: "warn",
      username: "admin",
      temporaryPassword: "abcd-efgh-jkmn-pqrs",
    });
  });

  it("does not repeat a password the operator supplied", () => {
    const lines: string[] = [];
    announceInitialAdmin(
      {
        username: "admin",
        password: "preset-password-1",
        created: true,
        fromConfig: true,
      },
      (line) => lines.push(line),
    );
    expect(lines[0]).not.toContain("preset-password-1");
  });
});
