import type {
  AuthSuccessResponse,
  TwoFactorSetupResponse,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createMemoryMailer } from "../../mail/mailer.js";
import { createStorage } from "../../storage/index.js";
import type { StorageDriver } from "../../storage/types.js";
import { defined } from "../../test/defined.js";
import { authHeaders, TEST_CONFIG } from "../../test/setup.js";
import { createAuthProvider } from "../index.js";
import { base32Decode, hotp, totpStep } from "../totp.js";

const cfg = {
  ...TEST_CONFIG,
  mail: {
    url: "smtp://mail.example",
    from: "notes@example.com",
    appUrl: "https://notes.example",
  },
};
const PASSWORD = "test-pass-12";

describe("sign-in by a mailed link", () => {
  let storage: StorageDriver;
  let mailer: ReturnType<typeof createMemoryMailer>;
  let request: (path: string, init?: RequestInit) => Promise<Response>;

  const post = (path: string, body: unknown, headers: HeadersInit = {}) =>
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  /** Lets the mail that goes out after the answer arrive. */
  const settle = () => new Promise((r) => setTimeout(r, 20));

  async function boot(config = cfg) {
    storage = await createStorage(config);
    mailer = createMemoryMailer();
    const { app } = createApp({
      cfg: config,
      storage,
      authProvider: createAuthProvider(config, storage),
      mailer,
    });
    request = async (path, init) => app.request(path, init);
    const res = await post("/api/auth/register", {
      username: "alice",
      password: PASSWORD,
      email: "alice@example.com",
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as AuthSuccessResponse).token;
  }

  /** Asks for a link and reads its token out of the mail. */
  async function mailedToken(): Promise<string> {
    const asked = await post("/api/auth/sign-in-link", {
      email: "alice@example.com",
    });
    expect(asked.status).toBe(204);
    await settle();
    const match = /#signin=([0-9a-f]+)/.exec(defined(mailer.sent.at(-1)).text);
    return defined(match?.[1]);
  }

  async function alice() {
    const user = await storage.users.findByUsername("alice");
    if (!user) throw new Error("no alice");
    return user;
  }

  const confirm = (token: string, extra: object = {}) =>
    post("/api/auth/sign-in-link/confirm", { token, ...extra });

  beforeEach(async () => {
    await boot();
  });

  afterEach(async () => {
    await storage.close();
  });

  it("mails a link that signs in once, and leaves other sessions alone", async () => {
    const before = await post("/api/auth/login", {
      username: "alice",
      password: PASSWORD,
    });
    const { token: oldSession } = (await before.json()) as AuthSuccessResponse;

    const token = await mailedToken();
    expect(mailer.sent[0]?.to).toBe("alice@example.com");
    expect(mailer.sent[0]?.text).toContain("https://notes.example/#signin=");

    const first = await confirm(token);
    expect(first.status).toBe(200);
    const body = (await first.json()) as AuthSuccessResponse;
    expect(body.user.username).toBe("alice");
    expect(
      (await request("/api/auth/me", { headers: authHeaders(body.token) }))
        .status,
    ).toBe(200);
    expect((await confirm(token)).status).toBe(410);
    expect(
      (await request("/api/auth/me", { headers: authHeaders(oldSession) }))
        .status,
    ).toBe(200);

    const user = await alice();
    const entries = await storage.audit.list({ limit: 20 });
    const signedIn = entries.find(
      (e) => e.action === "auth.signed_in" && e.detail.method === "link",
    );
    expect(signedIn?.actorId).toBe(user.id);
    expect(
      entries.some((e) => e.action === "auth.sign_in_link_requested"),
    ).toBe(true);
  });

  it("answers the same for an address nobody has, and sends nothing", async () => {
    const res = await post("/api/auth/sign-in-link", {
      email: "nobody@example.com",
    });
    expect(res.status).toBe(204);
    await settle();
    expect(mailer.sent).toEqual([]);
  });

  it("spaces links out, so an inbox cannot be flooded", async () => {
    await mailedToken();
    await post("/api/auth/sign-in-link", { email: "alice@example.com" });
    await settle();
    expect(mailer.sent).toHaveLength(1);
  });

  it("writes in the language asked for", async () => {
    await post("/api/auth/sign-in-link", {
      email: "alice@example.com",
      locale: "fi",
    });
    await settle();
    expect(mailer.sent[0]?.subject).toBe("Kirjautumislinkkisi");
  });

  it("refuses a made-up token and an expired one", async () => {
    expect((await confirm("0".repeat(64))).status).toBe(410);
    const token = await mailedToken();
    // The link's fifteen minutes, gone.
    await storage.signInLinks.deleteExpired("2999-01-01T00:00:00.000Z");
    expect((await confirm(token)).status).toBe(410);
  });

  it("sends no link to an account holding a temporary password, and refuses one sent before", async () => {
    const token = await mailedToken();
    const user = await alice();
    await storage.users.setPassword(user.id, user.passwordHash ?? "", true);
    expect((await confirm(token)).status).toBe(410);

    mailer.sent.length = 0;
    await storage.signInLinks.deleteExpired("2999-01-01T00:00:00.000Z");
    await post("/api/auth/sign-in-link", { email: "alice@example.com" });
    await settle();
    expect(mailer.sent).toEqual([]);
  });

  it("still asks for the second factor, and spends the link only once it holds", async () => {
    const session = await (
      await post("/api/auth/login", { username: "alice", password: PASSWORD })
    ).json();
    const headers = authHeaders((session as AuthSuccessResponse).token);
    const setup = await post(
      "/api/auth/two-factor/setup",
      { password: PASSWORD },
      headers,
    );
    const { secret } = (await setup.json()) as TwoFactorSetupResponse;
    const codeAt = (offset: number) =>
      hotp(base32Decode(secret), totpStep(Date.now()) + offset);
    expect(
      (await post("/api/auth/two-factor/enable", { code: codeAt(-1) }, headers))
        .status,
    ).toBe(200);

    const token = await mailedToken();
    const asked = await confirm(token);
    expect(asked.status).toBe(403);
    expect(((await asked.json()) as { code: string }).code).toBe(
      "two_factor_required",
    );
    // A wrong code costs an attempt, not the link.
    expect((await confirm(token, { otp: "000000" })).status).toBe(401);
    const passed = await confirm(token, { otp: codeAt(0) });
    expect(passed.status).toBe(200);
    expect((await confirm(token, { otp: codeAt(1) })).status).toBe(410);
  });
});

describe("sign-in by a mailed link, switched off or without mail", () => {
  const ask = async (config: typeof TEST_CONFIG) => {
    const storage = await createStorage(config);
    const { app } = createApp({
      cfg: config,
      storage,
      authProvider: createAuthProvider(config, storage),
      mailer: createMemoryMailer(),
    });
    const res = await app.request("/api/auth/sign-in-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c" }),
    });
    const caps = await (await app.request("/api/capabilities")).json();
    await storage.close();
    return { status: res.status, offered: caps.auth.magicLink as boolean };
  };

  it("is not there without mail", async () => {
    expect(await ask(TEST_CONFIG)).toEqual({ status: 404, offered: false });
  });

  it("is not there with MAGIC_LINKS off", async () => {
    expect(await ask({ ...cfg, magicLinks: false })).toEqual({
      status: 404,
      offered: false,
    });
  });

  it("is offered with mail and the switch on", async () => {
    expect(await ask(cfg)).toEqual({ status: 204, offered: true });
  });
});
