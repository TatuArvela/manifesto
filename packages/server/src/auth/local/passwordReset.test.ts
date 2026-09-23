import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createMemoryMailer } from "../../mail/mailer.js";
import { createStorage } from "../../storage/index.js";
import type { StorageDriver } from "../../storage/types.js";
import { authHeaders, TEST_CONFIG } from "../../test/setup.js";
import { createAuthProvider } from "../index.js";

const cfg = {
  ...TEST_CONFIG,
  mail: {
    url: "smtp://mail.example",
    from: "notes@example.com",
    appUrl: "https://notes.example",
  },
};

describe("password reset by mail", () => {
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

  beforeEach(async () => {
    storage = await createStorage(cfg);
    mailer = createMemoryMailer();
    const { app } = createApp({
      cfg,
      storage,
      authProvider: createAuthProvider(cfg, storage),
      mailer,
    });
    request = async (path, init) => app.request(path, init);
    const res = await post("/api/auth/register", {
      username: "alice",
      password: "test-pass-12",
      email: "alice@example.com",
    });
    expect(res.status).toBe(201);
  });

  afterEach(async () => {
    await storage.close();
  });

  function tokenFrom(text: string): string {
    const match = /#reset=([0-9a-f]+)/.exec(text);
    expect(match).not.toBeNull();
    return match?.[1] ?? "";
  }

  it("mails a link that sets a new password once and ends other sessions", async () => {
    const before = await post("/api/auth/login", {
      username: "alice",
      password: "test-pass-12",
    });
    const { token: oldSession } = await before.json();

    expect(
      (await post("/api/auth/password-reset", { email: "ALICE@example.com" }))
        .status,
    ).toBe(204);
    await settle();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("ALICE@example.com");
    expect(mailer.sent[0].text).toContain("https://notes.example/#reset=");
    const token = tokenFrom(mailer.sent[0].text);

    const confirm = { token, newPassword: "brand-new-pass" };
    expect(
      (await post("/api/auth/password-reset/confirm", confirm)).status,
    ).toBe(204);
    expect(
      (await post("/api/auth/password-reset/confirm", confirm)).status,
    ).toBe(410);
    expect(
      (await request("/api/notes", { headers: authHeaders(oldSession) }))
        .status,
    ).toBe(401);
    expect(
      (
        await post("/api/auth/login", {
          username: "alice",
          password: "brand-new-pass",
        })
      ).status,
    ).toBe(200);
  });

  it("answers the same for an address nobody has, and sends nothing", async () => {
    const res = await post("/api/auth/password-reset", {
      email: "nobody@example.com",
    });
    expect(res.status).toBe(204);
    await settle();
    expect(mailer.sent).toEqual([]);
  });

  it("spaces links out, so an inbox cannot be flooded", async () => {
    await post("/api/auth/password-reset", { email: "alice@example.com" });
    await settle();
    await post("/api/auth/password-reset", { email: "alice@example.com" });
    await settle();
    expect(mailer.sent).toHaveLength(1);
  });

  it("writes in the language asked for", async () => {
    await post("/api/auth/password-reset", {
      email: "alice@example.com",
      locale: "fi",
    });
    await settle();
    expect(mailer.sent[0].subject).toBe("Salasanan vaihtaminen");
  });

  it("refuses a made-up token", async () => {
    const res = await post("/api/auth/password-reset/confirm", {
      token: "0".repeat(64),
      newPassword: "brand-new-pass",
    });
    expect(res.status).toBe(410);
  });

  it("mails a share invitation to a recipient with an address", async () => {
    const owner = await post("/api/auth/register", {
      username: "olivia",
      password: "test-pass-12",
    });
    const { token } = await owner.json();
    const alice = await storage.users.findByUsername("alice");
    const created = await request("/api/notes", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        title: "Trip plan",
        content: "",
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
    const { note } = await created.json();
    await request(`/api/notes/${note.id}/shares`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ userId: alice?.id, role: "edit" }),
    });
    await settle();
    expect(mailer.sent.at(-1)).toMatchObject({
      to: "alice@example.com",
      subject: "olivia shared a note with you",
    });
    expect(mailer.sent.at(-1)?.text).toContain("Trip plan");
  });
});

describe("password reset without mail", () => {
  it("is not there", async () => {
    const storage = await createStorage(TEST_CONFIG);
    const { app } = createApp({
      cfg: TEST_CONFIG,
      storage,
      authProvider: createAuthProvider(TEST_CONFIG, storage),
    });
    const res = await app.request("/api/auth/password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c" }),
    });
    expect(res.status).toBe(404);
    await storage.close();
  });
});
