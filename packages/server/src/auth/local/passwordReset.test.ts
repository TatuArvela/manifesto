import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "#/app.ts";
import { createAuthProvider } from "#/auth/index.ts";
import { createMemoryMailer } from "#/mail/mailer.ts";
import { createStorage } from "#/storage/index.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { defined } from "#/test/defined.ts";
import { sealingClient } from "#/test/sealingClient.ts";
import { authHeaders, TEST_CONFIG } from "#/test/setup.ts";

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
    request = sealingClient(async (path, init) => app.request(path, init));
    const res = await post("/api/v1/auth/register", {
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
    const before = await post("/api/v1/auth/login", {
      username: "alice",
      password: "test-pass-12",
    });
    const { token: oldSession } = await before.json();

    expect(
      (
        await post("/api/v1/auth/password-reset", {
          email: "ALICE@example.com",
        })
      ).status,
    ).toBe(204);
    await settle();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("ALICE@example.com");
    expect(mailer.sent[0]?.text).toContain("https://notes.example/#reset=");
    const token = tokenFrom(defined(mailer.sent[0]).text);

    const confirm = { token, newPassword: "brand-new-pass" };
    expect(
      (await post("/api/v1/auth/password-reset/confirm", confirm)).status,
    ).toBe(204);
    expect(
      (await post("/api/v1/auth/password-reset/confirm", confirm)).status,
    ).toBe(410);
    expect(
      (await request("/api/v1/notes", { headers: authHeaders(oldSession) }))
        .status,
    ).toBe(401);
    expect(
      (
        await post("/api/v1/auth/login", {
          username: "alice",
          password: "brand-new-pass",
        })
      ).status,
    ).toBe(200);
  });

  it("answers the same for an address nobody has, and sends nothing", async () => {
    const res = await post("/api/v1/auth/password-reset", {
      email: "nobody@example.com",
    });
    expect(res.status).toBe(204);
    await settle();
    expect(mailer.sent).toEqual([]);
  });

  it("spaces links out, so an inbox cannot be flooded", async () => {
    await post("/api/v1/auth/password-reset", { email: "alice@example.com" });
    await settle();
    await post("/api/v1/auth/password-reset", { email: "alice@example.com" });
    await settle();
    expect(mailer.sent).toHaveLength(1);
  });

  it("does not make the next request wait for a mail that could not be sent", async () => {
    const send = mailer.send;
    mailer.send = async () => false;
    await post("/api/v1/auth/password-reset", { email: "alice@example.com" });
    await settle();
    const entries = await storage.audit.list({ limit: 20 });
    expect(
      entries.some((e) => e.action === "auth.password_reset_requested"),
    ).toBe(false);

    mailer.send = send;
    await post("/api/v1/auth/password-reset", { email: "alice@example.com" });
    await settle();
    expect(mailer.sent).toHaveLength(1);
  });

  it("writes in the language asked for", async () => {
    await post("/api/v1/auth/password-reset", {
      email: "alice@example.com",
      locale: "fi",
    });
    await settle();
    expect(mailer.sent[0]?.subject).toBe("Salasanan vaihtaminen");
  });

  it("voids a link when the password or the address it went to changes", async () => {
    const signedIn = await post("/api/v1/auth/login", {
      username: "alice",
      password: "test-pass-12",
    });
    const { token: session } = (await signedIn.json()) as { token: string };
    const ask = async () => {
      mailer.sent.length = 0;
      // After the cooldown between two links for one account.
      const alice = await storage.users.findByUsername("alice");
      await storage.passwordResets.deleteByUser(alice?.id ?? "");
      await post("/api/v1/auth/password-reset", { email: "alice@example.com" });
      await settle();
      return tokenFrom(defined(mailer.sent[0]).text);
    };

    const beforeChange = await ask();
    const changed = await post(
      "/api/v1/auth/password",
      { currentPassword: "test-pass-12", newPassword: "another-pass-34" },
      authHeaders(session),
    );
    expect(changed.status).toBe(204);
    expect(
      (
        await post("/api/v1/auth/password-reset/confirm", {
          token: beforeChange,
          newPassword: "attacker-pass-1",
        })
      ).status,
    ).toBe(410);

    const beforeMove = await ask();
    const moved = await request("/api/v1/auth/me", {
      method: "PUT",
      headers: authHeaders(session),
      body: JSON.stringify({
        email: "alice@elsewhere.example",
        password: "another-pass-34",
      }),
    });
    expect(moved.status).toBe(200);
    expect(
      (
        await post("/api/v1/auth/password-reset/confirm", {
          token: beforeMove,
          newPassword: "attacker-pass-1",
        })
      ).status,
    ).toBe(410);
  });

  it("refuses a made-up token", async () => {
    const res = await post("/api/v1/auth/password-reset/confirm", {
      token: "0".repeat(64),
      newPassword: "brand-new-pass",
    });
    expect(res.status).toBe(410);
  });

  it("mails a share invitation to a recipient with an address", async () => {
    const owner = await post("/api/v1/auth/register", {
      username: "olivia",
      password: "test-pass-12",
    });
    const { token } = await owner.json();
    const alice = await storage.users.findByUsername("alice");
    const created = await request("/api/v1/notes", {
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
    await request(`/api/v1/notes/${note.id}/shares`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ userId: alice?.id, role: "edit" }),
    });
    await settle();
    expect(mailer.sent.at(-1)).toMatchObject({
      to: "alice@example.com",
      subject: "olivia shared a note with you",
    });
    // The title of the note is sealed. Thus, the mail cannot name it.
    expect(mailer.sent.at(-1)?.text).not.toContain("Trip plan");
    expect(mailer.sent.at(-1)?.text).not.toContain("e1.");
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
    const res = await app.request("/api/v1/auth/password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c" }),
    });
    expect(res.status).toBe(404);
    await storage.close();
  });
});
