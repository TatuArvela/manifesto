import type {
  AdminTemporaryPasswordResponse,
  AdminUserResponse,
  AdminUsersResponse,
  AuthMeResponse,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueSession } from "../auth/session.js";
import {
  authHeaders,
  bootTestApp,
  bootTestAppWith,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";

async function signIn(
  rig: TestRig,
  body: { username: string; password: string; newPassword?: string },
): Promise<Response> {
  return rig.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin routes", () => {
  let rig: TestRig;
  let admin: { token: string; userId: string };
  let bob: { token: string; userId: string };

  beforeEach(async () => {
    rig = await bootTestApp();
    admin = await registerTestUser(rig, "admin");
    bob = await registerTestUser(rig, "bob");
  });

  afterEach(async () => {
    await rig.close();
  });

  function adminRequest(path: string, init: RequestInit = {}) {
    return rig.request(`/api/admin${path}`, {
      ...init,
      headers: authHeaders(admin.token),
    });
  }

  it("makes the first account on the server its admin", async () => {
    const me = async (token: string) =>
      (
        (await (
          await rig.request("/api/auth/me", { headers: authHeaders(token) })
        ).json()) as AuthMeResponse
      ).user.isAdmin;
    expect(await me(admin.token)).toBe(true);
    expect(await me(bob.token)).toBe(false);
  });

  it("refuses anyone who is not signed in, and anyone who is not an admin", async () => {
    expect((await rig.request("/api/admin/users")).status).toBe(401);
    const res = await rig.request("/api/admin/users", {
      headers: authHeaders(bob.token),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Admin access required" });
  });

  it("lists every account", async () => {
    const res = await adminRequest("/users");
    expect(res.status).toBe(200);
    const { users } = (await res.json()) as AdminUsersResponse;
    expect(users.map((u) => [u.username, u.isAdmin, u.provider])).toEqual([
      ["admin", true, "local"],
      ["bob", false, "local"],
    ]);
    expect(users[1]).toMatchObject({
      noteCount: 0,
      mustChangePassword: false,
    });
    expect(users[1]?.lastSeenAt).toEqual(expect.any(String));
  });

  it("creates an account whose temporary password must be replaced at first sign-in", async () => {
    const res = await adminRequest("/users", {
      method: "POST",
      body: JSON.stringify({ username: "carol" }),
    });
    expect(res.status).toBe(201);
    const { user, temporaryPassword } =
      (await res.json()) as AdminTemporaryPasswordResponse;
    expect(user).toMatchObject({
      username: "carol",
      isAdmin: false,
      mustChangePassword: true,
    });
    expect(temporaryPassword).toMatch(/^([a-z2-9]{4}-){3}[a-z2-9]{4}$/);

    // No session until the password is replaced.
    const blocked = await signIn(rig, {
      username: "carol",
      password: temporaryPassword,
    });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({
      error: "Choose a new password to finish signing in",
      code: "password_change_required",
    });

    const same = await signIn(rig, {
      username: "carol",
      password: temporaryPassword,
      newPassword: temporaryPassword,
    });
    expect(same.status).toBe(422);

    const done = await signIn(rig, {
      username: "carol",
      password: temporaryPassword,
      newPassword: "carols-own-pass",
    });
    expect(done.status).toBe(200);

    expect(
      (await signIn(rig, { username: "carol", password: temporaryPassword }))
        .status,
    ).toBe(401);
    expect(
      (await signIn(rig, { username: "carol", password: "carols-own-pass" }))
        .status,
    ).toBe(200);
  });

  it("does not reveal that a password is temporary to a wrong guess", async () => {
    await adminRequest("/users", {
      method: "POST",
      body: JSON.stringify({ username: "carol" }),
    });
    const res = await signIn(rig, {
      username: "carol",
      password: "not-the-password",
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Invalid username or password",
    });
  });

  it("refuses to create an account under a name already taken", async () => {
    const res = await adminRequest("/users", {
      method: "POST",
      body: JSON.stringify({ username: "BOB" }),
    });
    expect(res.status).toBe(409);
    const blank = await adminRequest("/users", {
      method: "POST",
      body: JSON.stringify({ username: "  " }),
    });
    expect(blank.status).toBe(422);
  });

  it("grants and revokes admin, taking effect on the next request", async () => {
    const grant = await adminRequest(`/users/${bob.userId}`, {
      method: "PUT",
      body: JSON.stringify({ isAdmin: true }),
    });
    expect(grant.status).toBe(200);
    expect(((await grant.json()) as AdminUserResponse).user.isAdmin).toBe(true);
    expect(
      (
        await rig.request("/api/admin/users", {
          headers: authHeaders(bob.token),
        })
      ).status,
    ).toBe(200);

    const revoke = await adminRequest(`/users/${bob.userId}`, {
      method: "PUT",
      body: JSON.stringify({ isAdmin: false }),
    });
    expect(revoke.status).toBe(200);
    expect(
      (
        await rig.request("/api/admin/users", {
          headers: authHeaders(bob.token),
        })
      ).status,
    ).toBe(403);
  });

  it("refuses an admin changing their own account", async () => {
    const demote = await adminRequest(`/users/${admin.userId}`, {
      method: "PUT",
      body: JSON.stringify({ isAdmin: false }),
    });
    expect(demote.status).toBe(409);
    const reset = await adminRequest(`/users/${admin.userId}/password`, {
      method: "POST",
    });
    expect(reset.status).toBe(409);
    const remove = await adminRequest(`/users/${admin.userId}`, {
      method: "DELETE",
    });
    expect(remove.status).toBe(409);
    expect(await rig.storage.users.findById(admin.userId)).toMatchObject({
      isAdmin: true,
    });
  });

  it("answers 404 for an account that does not exist", async () => {
    const put = await adminRequest("/users/nobody", {
      method: "PUT",
      body: JSON.stringify({ isAdmin: true }),
    });
    expect(put.status).toBe(404);
    expect(
      (await adminRequest("/users/nobody/password", { method: "POST" })).status,
    ).toBe(404);
    expect(
      (await adminRequest("/users/nobody", { method: "DELETE" })).status,
    ).toBe(404);
  });

  it("resets a password, ending the sessions that used the old one", async () => {
    const res = await adminRequest(`/users/${bob.userId}/password`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const { user, temporaryPassword } =
      (await res.json()) as AdminTemporaryPasswordResponse;
    expect(user.mustChangePassword).toBe(true);

    const stale = await rig.request("/api/notes", {
      headers: authHeaders(bob.token),
    });
    expect(stale.status).toBe(401);

    expect(
      (await signIn(rig, { username: "bob", password: "test-pass-12" })).status,
    ).toBe(401);
    const signedIn = await signIn(rig, {
      username: "bob",
      password: temporaryPassword,
      newPassword: "bobs-new-pass",
    });
    expect(signedIn.status).toBe(200);
  });

  it("refuses to reset the password of an account that signs in through SSO", async () => {
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
    const res = await adminRequest(`/users/${sso.id}/password`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
  });

  it("deletes an account along with its notes and sessions", async () => {
    const note = await rig.request("/api/notes", {
      method: "POST",
      headers: authHeaders(bob.token),
      body: JSON.stringify({
        title: "",
        content: "bob's",
        color: "default",
        font: "default",
        pinned: false,
        archived: false,
        trashed: false,
        position: 0,
        tags: [],
        images: [],
        linkPreviews: [],
        reminder: null,
      }),
    });
    expect(note.status).toBe(201);

    const listed = (await (await adminRequest("/users")).json()) as {
      users: { username: string; noteCount: number }[];
    };
    expect(listed.users.find((u) => u.username === "bob")?.noteCount).toBe(1);

    const res = await adminRequest(`/users/${bob.userId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    expect(await rig.storage.users.findById(bob.userId)).toBeNull();
    expect(
      (
        await rig.request("/api/notes", {
          headers: authHeaders(bob.token),
        })
      ).status,
    ).toBe(401);
    // The name is free again.
    await registerTestUser(rig, "bob");
  });
});

describe("admin routes under single sign-on", () => {
  let rig: TestRig;
  let token: string;

  beforeEach(async () => {
    rig = await bootTestAppWith({
      authProvider: "oidc",
      oidc: {
        issuer: "https://idp.example.com",
        clientId: "manifesto",
        clientSecret: "secret",
        redirectUri: "http://localhost:3001/api/auth/callback",
        postLoginRedirect: "http://localhost:5173/",
        scopes: ["openid"],
      },
    });
    const user = await rig.storage.users.create({
      id: "sso-admin",
      username: "admin",
      passwordHash: null,
      displayName: "",
      avatarColor: "",
      provider: "oidc:https://idp.example.com",
      externalId: "sub-admin",
      createdAt: new Date().toISOString(),
    });
    await rig.storage.users.create({
      id: "sso-bob",
      username: "bob",
      passwordHash: null,
      displayName: "",
      avatarColor: "",
      provider: "oidc:https://idp.example.com",
      externalId: "sub-bob",
      createdAt: new Date().toISOString(),
    });
    ({ token } = await issueSession(rig.storage, rig.cfg, user.id));
  });

  afterEach(async () => {
    await rig.close();
  });

  it("lists accounts, and leaves creating them and their passwords to the identity provider", async () => {
    const list = await rig.request("/api/admin/users", {
      headers: authHeaders(token),
    });
    expect(list.status).toBe(200);
    const { users } = (await list.json()) as AdminUsersResponse;
    expect(users.map((u) => u.provider)).toEqual(["oidc", "oidc"]);

    const create = await rig.request("/api/admin/users", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ username: "carol" }),
    });
    expect(create.status).toBe(404);
    const reset = await rig.request("/api/admin/users/sso-bob/password", {
      method: "POST",
      headers: authHeaders(token),
    });
    expect(reset.status).toBe(404);

    const remove = await rig.request("/api/admin/users/sso-bob", {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(remove.status).toBe(204);
  });
});
