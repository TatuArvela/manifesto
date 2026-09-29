import {
  type AdminChecksResponse,
  type AdminTestMailResponse,
  PROXY_PROBE_ADDRESS,
} from "@manifesto/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createAuthProvider } from "../auth/index.js";
import type { ServerConfig } from "../config.js";
import { createMemoryMailer, type Mailer } from "../mail/mailer.js";
import { createStorage } from "../storage/index.js";
import type { StorageDriver } from "../storage/types.js";
import {
  authHeaders,
  bootTestAppWith,
  registerTestUser,
  TEST_CONFIG,
  type TestRig,
} from "../test/setup.js";
import { proxyFinding } from "./adminChecks.js";

const MAIL_CONFIG: ServerConfig["mail"] = {
  url: "smtp://mail.example",
  from: "notes@example.com",
  appUrl: "https://notes.example",
};

describe("proxyFinding", () => {
  const probe = PROXY_PROBE_ADDRESS;

  it("tells an untouched probe from one a proxy replaced, added to or dropped", () => {
    expect(proxyFinding(probe)).toBe("untouched");
    expect(proxyFinding("198.51.100.4")).toBe("overwritten");
    expect(proxyFinding(`${probe}, 198.51.100.4`)).toBe("appended");
    expect(proxyFinding(`${probe},198.51.100.4, 10.0.0.2`)).toBe("appended");
    expect(proxyFinding(undefined)).toBe("removed");
    expect(proxyFinding(" , ")).toBe("removed");
  });
});

describe("admin setup checks", () => {
  let rig: TestRig | null = null;
  let storage: StorageDriver | null = null;

  afterEach(async () => {
    await rig?.close();
    await storage?.close();
    rig = null;
    storage = null;
  });

  async function checks(
    target: TestRig | { request: TestRig["request"] },
    token: string,
    forwardedFor?: string,
  ): Promise<AdminChecksResponse> {
    const res = await target.request("/api/admin/checks", {
      headers: {
        ...authHeaders(token),
        ...(forwardedFor !== undefined && { "X-Forwarded-For": forwardedFor }),
      },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as AdminChecksResponse;
  }

  /** The server's first account, so its admin; its token. */
  async function register(
    server: { request: TestRig["request"] },
    email: string | null,
  ): Promise<string> {
    const res = await server.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "admin",
        password: "test-pass-12",
        ...(email !== null && { email }),
      }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { token: string }).token;
  }

  /** A server whose mail goes through `mailer`, and its admin. */
  async function withMail(
    mailer: Mailer,
    email: string | null = "admin@example.com",
  ) {
    const cfg: ServerConfig = { ...TEST_CONFIG, mail: MAIL_CONFIG };
    storage = await createStorage(cfg);
    const { app } = createApp({
      cfg,
      storage,
      authProvider: createAuthProvider(cfg, storage),
      mailer,
    });
    const request: TestRig["request"] = async (path, init) =>
      app.request(path, init);
    return { request, token: await register({ request }, email) };
  }

  it("is for admins only", async () => {
    rig = await bootTestAppWith({});
    await registerTestUser(rig, "admin");
    const bob = await registerTestUser(rig, "bob");
    const res = await rig.request("/api/admin/checks", {
      headers: authHeaders(bob.token),
    });
    expect(res.status).toBe(403);
  });

  it("reports the settings and what became of the probe", async () => {
    rig = await bootTestAppWith({
      appUrl: "https://notes.example",
      trustProxy: true,
    });
    const admin = await registerTestUser(rig, "admin");
    const body = await checks(
      rig,
      admin.token,
      `${PROXY_PROBE_ADDRESS}, 198.51.100.4`,
    );
    expect(body).toEqual({
      appUrl: "https://notes.example",
      trustProxy: true,
      proxy: "appended",
      backup: { scheduled: false, lastFinishedAt: null, lastError: null },
      mail: null,
    });
  });

  it("has no backup check on Postgres, whose backups are its own", async () => {
    // The check reads only the setting, so SQLite storage stands in.
    storage = await createStorage(TEST_CONFIG);
    const cfg: ServerConfig = { ...TEST_CONFIG, storageDriver: "postgres" };
    const { app } = createApp({
      cfg,
      storage,
      authProvider: createAuthProvider(cfg, storage),
    });
    const server = {
      request: async (path: string, init?: RequestInit) =>
        app.request(path, init),
    };
    const token = await register(server, null);
    expect((await checks(server, token, PROXY_PROBE_ADDRESS)).backup).toBe(
      null,
    );
  });

  it("sends a test message to the admin and remembers that it went", async () => {
    const mailer = createMemoryMailer();
    const server = await withMail(mailer);
    expect((await checks(server, server.token)).mail).toEqual({
      lastSentAt: null,
      lastFailedAt: null,
    });

    const res = await server.request("/api/admin/checks/mail", {
      method: "POST",
      headers: authHeaders(server.token),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as AdminTestMailResponse).toEqual({ sent: true });
    expect(mailer.sent).toEqual([
      expect.objectContaining({
        to: "admin@example.com",
        subject: "Test message",
      }),
    ]);
    const { mail } = await checks(server, server.token);
    expect(mail?.lastSentAt).toEqual(expect.any(String));
    expect(mail?.lastFailedAt).toBe(null);
  });

  it("remembers a message that could not go", async () => {
    const server = await withMail({ send: async () => false });
    const res = await server.request("/api/admin/checks/mail", {
      method: "POST",
      headers: authHeaders(server.token),
    });
    expect((await res.json()) as AdminTestMailResponse).toEqual({
      sent: false,
    });
    const { mail } = await checks(server, server.token);
    expect(mail?.lastSentAt).toBe(null);
    expect(mail?.lastFailedAt).toEqual(expect.any(String));
  });

  it("refuses a test message without mail, or to an account with no address", async () => {
    rig = await bootTestAppWith({});
    const admin = await registerTestUser(rig, "admin");
    const noMail = await rig.request("/api/admin/checks/mail", {
      method: "POST",
      headers: authHeaders(admin.token),
    });
    expect(noMail.status).toBe(409);

    const server = await withMail(createMemoryMailer(), null);
    const res = await server.request("/api/admin/checks/mail", {
      method: "POST",
      headers: authHeaders(server.token),
    });
    expect(res.status).toBe(409);
  });
});
