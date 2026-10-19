import type {
  LinkPreview,
  LinkPreviewResponse,
  NoteCreate,
} from "@manifesto/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "#/app.ts";
import { createAuthProvider } from "#/auth/index.ts";
import type { ServerConfig } from "#/config.ts";
import type { LinkPreviewFetcher } from "#/linkPreview/fetchPreview.ts";
import { sealedCreate } from "#/storage/contracts/claimed.ts";
import { createStorage } from "#/storage/index.ts";
import { sealingClient } from "#/test/sealingClient.ts";
import {
  authHeaders,
  registerTestUser,
  TEST_CONFIG,
  type TestRig,
} from "#/test/setup.ts";

const PREVIEW: LinkPreview = {
  url: "https://example.com/post",
  title: "A post",
  domain: "example.com",
};

let rig: TestRig | null = null;

async function boot(
  fetchLinkPreview: LinkPreviewFetcher,
  overrides: Partial<ServerConfig> = {},
): Promise<TestRig> {
  const cfg: ServerConfig = { ...TEST_CONFIG, ...overrides };
  const storage = await createStorage(cfg);
  const authProvider = createAuthProvider(cfg, storage);
  const { app, broadcaster } = createApp({
    cfg,
    storage,
    authProvider,
    fetchLinkPreview,
  });
  rig = {
    cfg,
    storage,
    authProvider,
    broadcaster,
    app,
    request: sealingClient(async (input, init) => app.request(input, init)),
    rawRequest: async (input, init) => app.request(input, init),
    close: async () => storage.close(),
  };
  return rig;
}

afterEach(async () => {
  await rig?.close();
  rig = null;
});

const query = (url: string) =>
  `/api/v1/link-preview?url=${encodeURIComponent(url)}`;

describe("GET /api/v1/link-preview", () => {
  it("returns what the fetcher found for the URL", async () => {
    const fetcher = vi.fn<LinkPreviewFetcher>(async () => PREVIEW);
    const app = await boot(fetcher);
    const { token } = await registerTestUser(app);

    const res = await app.request(query(PREVIEW.url), {
      headers: authHeaders(token),
    });

    expect(res.status).toBe(200);
    expect((await res.json()) as LinkPreviewResponse).toEqual({
      preview: PREVIEW,
    });
    expect(fetcher).toHaveBeenCalledWith(PREVIEW.url);
  });

  it("returns a null preview when the page could not be fetched", async () => {
    const app = await boot(async () => null);
    const { token } = await registerTestUser(app);
    const res = await app.request(query("https://down.example/"), {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ preview: null });
  });

  it("requires a session", async () => {
    const fetcher = vi.fn<LinkPreviewFetcher>(async () => PREVIEW);
    const app = await boot(fetcher);
    const res = await app.request(query(PREVIEW.url));
    expect(res.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a URL that is missing, not http(s), or too long", async () => {
    const fetcher = vi.fn<LinkPreviewFetcher>(async () => PREVIEW);
    const app = await boot(fetcher);
    const { token } = await registerTestUser(app);
    for (const path of [
      "/api/v1/link-preview",
      query("javascript:alert(1)"),
      query("file:///etc/passwd"),
      query(`https://example.com/${"a".repeat(2100)}`),
    ]) {
      const res = await app.request(path, { headers: authHeaders(token) });
      expect(res.status).toBe(422);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("answers 404 without fetching when previews are turned off", async () => {
    const fetcher = vi.fn<LinkPreviewFetcher>(async () => PREVIEW);
    const app = await boot(fetcher, { linkPreviews: false });
    const { token } = await registerTestUser(app);
    const res = await app.request(query(PREVIEW.url), {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("limits how many previews one user can ask for in a minute", async () => {
    const app = await boot(async () => PREVIEW);
    const { token } = await registerTestUser(app);
    const statuses: number[] = [];
    for (let i = 0; i < 41; i++) {
      const res = await app.request(query(`${PREVIEW.url}?n=${i}`), {
        headers: authHeaders(token),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 40).every((s) => s === 200)).toBe(true);
    expect(statuses[40]).toBe(429);
  });
});

describe("note link previews", () => {
  it("take a thumbnail only as an uploaded attachment", async () => {
    const app = await boot(async () => null);
    const { token } = await registerTestUser(app);
    const note = (image: string) => ({
      title: "",
      content: "",
      color: "default",
      font: "default",
      pinned: false,
      archived: false,
      trashed: false,
      position: 0,
      tags: [],
      images: [],
      linkPreviews: [{ ...PREVIEW, image }],
      reminder: null,
    });
    const post = (image: string) =>
      app.request("/api/v1/notes", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify(note(image)),
      });
    const upload = await app.request("/api/v1/attachments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "image/png",
      },
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    const { ref } = (await upload.json()) as { ref: string };

    // The cards are sealed, so what the server holds a thumbnail to is the
    // reference sent beside them.
    const withRefs = (previewRefs: string[]) =>
      app.rawRequest("/api/v1/notes", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          ...sealedCreate(note(ref) as unknown as NoteCreate),
          previewRefs,
        }),
      });
    expect((await post(ref)).status).toBe(201);
    expect((await withRefs([ref])).status).toBe(201);
    expect(
      (await withRefs(["data:image/png;base64,iVBORw0KGgo="])).status,
    ).toBe(422);
    expect((await withRefs(["javascript:alert(1)"])).status).toBe(422);
    expect(
      (await withRefs(["attachment:01ARZ3NDEKTSV4RRFFQ69G5FAV"])).status,
    ).toBe(422);
  });
});
