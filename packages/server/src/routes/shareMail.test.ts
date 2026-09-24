import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createAuthProvider } from "../auth/index.js";
import { createMemoryMailer } from "../mail/mailer.js";
import { createStorage } from "../storage/index.js";
import type { StorageDriver } from "../storage/types.js";
import { authHeaders, TEST_CONFIG } from "../test/setup.js";

const cfg = {
  ...TEST_CONFIG,
  mail: {
    url: "smtp://mail.example",
    from: "notes@example.com",
    appUrl: "https://notes.example",
  },
};

describe("a share invitation by mail", () => {
  let storage: StorageDriver;
  let mailer: ReturnType<typeof createMemoryMailer>;
  let request: (path: string, init?: RequestInit) => Promise<Response>;

  /** Lets the mail that goes out after the answer arrive. */
  const settle = () => new Promise((r) => setTimeout(r, 20));

  async function register(username: string) {
    const res = await request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password: "test-pass-12",
        email: `${username}@example.com`,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; user: { id: string } };
    return { token: body.token, userId: body.user.id };
  }

  const setLocale = (token: string, locale: unknown) =>
    request("/api/auth/me/locale", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ locale }),
    });

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
  });

  afterEach(async () => {
    await storage.close();
  });

  it("is written in the recipient's language, not the sharer's", async () => {
    const olivia = await register("olivia");
    const bob = await register("bob");
    expect((await setLocale(bob.token, "fi")).status).toBe(204);
    const me = await request("/api/auth/me", {
      headers: authHeaders(bob.token),
    });
    expect(
      ((await me.json()) as { user: { locale: string } }).user.locale,
    ).toBe("fi");

    const created = await request("/api/notes", {
      method: "POST",
      headers: { ...authHeaders(olivia.token), "Accept-Language": "en" },
      body: JSON.stringify({
        title: "Groceries",
        content: "",
        color: NoteColor.Default,
        font: NoteFont.Default,
        pinned: false,
        archived: false,
        trashed: false,
        trashedAt: null,
        position: 0,
        tags: [],
        images: [],
        linkPreviews: [],
        reminder: null,
      }),
    });
    const { note } = (await created.json()) as { note: { id: string } };
    const shared = await request(`/api/notes/${note.id}/shares`, {
      method: "POST",
      headers: { ...authHeaders(olivia.token), "Accept-Language": "en" },
      body: JSON.stringify({ userId: bob.userId, role: "edit" }),
    });
    expect(shared.status).toBe(201);
    await settle();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("bob@example.com");
    expect(mailer.sent[0].subject).toBe("olivia jakoi kanssasi muistiinpanon");
  });

  it("refuses something that is not a language tag", async () => {
    const bob = await register("bob");
    expect((await setLocale(bob.token, "<b>")).status).toBe(422);
    expect((await setLocale(bob.token, "")).status).toBe(422);
  });
});
