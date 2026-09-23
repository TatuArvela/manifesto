import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createAuthProvider } from "./auth/index.js";
import { buildOpenApiDocument, OPERATIONS, openApiPath } from "./openapi.js";
import { createStorage } from "./storage/index.js";
import { TEST_CONFIG } from "./test/setup.js";

/**
 * The document lists operations by hand, so this is what keeps it honest: it
 * must name every route the app registers, and nothing the app does not.
 * Adding an endpoint without describing it fails here.
 */
describe("OpenAPI document", () => {
  async function registered(): Promise<Set<string>> {
    const cfg = { ...TEST_CONFIG, webhooks: "public" as const };
    const storage = await createStorage(cfg);
    const { app, webhooks } = createApp({
      cfg,
      storage,
      authProvider: createAuthProvider(cfg, storage),
    });
    webhooks?.stop();
    await storage.close();
    return new Set(
      app.routes
        .filter((r) => r.method !== "ALL" && r.path.startsWith("/api/"))
        .map((r) => `${r.method.toLowerCase()} ${r.path}`),
    );
  }

  it("describes every route the app registers", async () => {
    const documented = new Set(OPERATIONS.map((o) => `${o.method} ${o.path}`));
    const missing = [...(await registered())].filter((r) => !documented.has(r));
    expect(missing).toEqual([]);
  });

  it("describes nothing the app does not register", async () => {
    const routes = await registered();
    const extra = OPERATIONS.filter((o) => o.provider !== "oidc")
      .map((o) => `${o.method} ${o.path}`)
      .filter((o) => !routes.has(o));
    expect(extra).toEqual([]);
  });

  it("resolves every reference and carries the zod request schemas", () => {
    const doc = buildOpenApiDocument("test");
    const json = JSON.stringify(doc);
    for (const [, name] of json.matchAll(/#\/components\/schemas\/(\w+)/g)) {
      expect(doc.components.schemas).toHaveProperty(name);
    }
    const create = doc.paths["/api/notes"].post as {
      requestBody: {
        content: { "application/json": { schema: { required: string[] } } };
      };
    };
    expect(
      create.requestBody.content["application/json"].schema.required,
    ).toContain("title");
    expect(Object.keys(doc.paths)).toContain(openApiPath("/api/notes/:id"));
  });

  it("is served", async () => {
    const cfg = TEST_CONFIG;
    const storage = await createStorage(cfg);
    const { app } = createApp({
      cfg,
      storage,
      authProvider: createAuthProvider(cfg, storage),
    });
    const res = await app.request("/api/openapi.json");
    expect(res.status).toBe(200);
    expect((await res.json()).openapi).toBe("3.1.0");
    await storage.close();
  });
});
