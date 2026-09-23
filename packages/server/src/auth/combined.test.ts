import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerConfig } from "../config.js";
import { bootTestAppWith, type TestRig } from "../test/setup.js";

const both: Partial<ServerConfig> = {
  authProvider: "both",
  passwordForm: "collapsed",
  oidc: {
    issuer: "https://idp.example",
    clientId: "manifesto",
    clientSecret: "secret",
    redirectUri: "https://notes.example/api/auth/callback",
    postLoginRedirect: "https://notes.example/",
    scopes: ["openid"],
    groupsClaim: "groups",
    adminGroup: null,
    userGroup: null,
    autoRegister: true,
  },
};

describe("local and single sign-on side by side", () => {
  let rig: TestRig;

  beforeEach(async () => {
    rig = await bootTestAppWith(both);
  });

  afterEach(async () => {
    await rig.close();
  });

  it("offers both, and says how to show the password form", async () => {
    const methods = await (await rig.request("/api/auth/methods")).json();
    expect(methods).toMatchObject({
      provider: "oidc",
      providers: ["local", "oidc"],
      passwordForm: "collapsed",
    });
  });

  it("signs in with a password, and knows the account has one", async () => {
    const register = await rig.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "test-pass-12" }),
    });
    expect(register.status).toBe(201);
    const login = await rig.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "test-pass-12" }),
    });
    expect(login.status).toBe(200);
    expect((await login.json()).user.hasPassword).toBe(true);
  });

  it("mounts the single sign-on routes as well", () => {
    const routes = rig.app.routes.map((r) => `${r.method} ${r.path}`);
    expect(routes).toContain("GET /api/auth/login");
    expect(routes).toContain("GET /api/auth/callback");
    expect(routes).toContain("POST /api/auth/login");
  });
});
