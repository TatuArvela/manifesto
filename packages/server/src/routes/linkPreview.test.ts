import type { LinkPreview, LinkPreviewResponse } from "@manifesto/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { createAuthProvider } from "../auth/index.js";
import type { ServerConfig } from "../config.js";
import type { LinkPreviewFetcher } from "../linkPreview/fetchPreview.js";
import { createStorage } from "../storage/index.js";
import {
  authHeaders,
  registerTestUser,
  TEST_CONFIG,
  type TestRig,
} from "../test/setup.js";

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
    request: async (input, init) => app.request(input, init),
    close: async () => storage.close(),
  };
  return rig;
}

afterEach(async () => {
  await rig?.close();
  rig = null;
});

const query = (url: string) =>
  `/api/link-preview?url=${encodeURIComponent(url)}`;

describe("GET /api/link-preview", () => {
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
      "/api/link-preview",
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
  it("accept an inlined thumbnail and refuse an oversized or scripted one", async () => {
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
      app.request("/api/notes", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify(note(image)),
      });

    expect((await post("data:image/png;base64,iVBORw0KGgo=")).status).toBe(201);
    expect(
      (await post(`data:image/png;base64,${"A".repeat(70 * 1024)}`)).status,
    ).toBe(422);
    expect(
      (await post("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).status,
    ).toBe(422);
    expect((await post("javascript:alert(1)")).status).toBe(422);
  });
});
