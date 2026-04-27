import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { onError } from "./error.js";
import { perUserApiRateLimit, rateLimit } from "./rateLimit.js";

function buildApp(limit: number, windowMs: number, key = "x") {
  const app = new Hono();
  app.onError(onError);
  app.use("*", rateLimit({ limit, windowMs, keyFor: () => key }));
  app.get("/", (c) => c.json({ ok: true }));
  return app;
}

describe("rateLimit", () => {
  it("allows requests up to the configured limit", async () => {
    const app = buildApp(3, 1_000_000);
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/");
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 with a Retry-After header once the limit is exceeded", async () => {
    const app = buildApp(2, 1_000_000);
    await app.request("/");
    await app.request("/");
    const res = await app.request("/");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(await res.json()).toEqual({ error: "Too many requests" });
  });

  it("isolates buckets by key", async () => {
    const sharedLimit = 1;
    const app = new Hono();
    app.onError(onError);
    let n = 0;
    app.use(
      "*",
      rateLimit({
        limit: sharedLimit,
        windowMs: 1_000_000,
        keyFor: () => `bucket-${n}`,
      }),
    );
    app.get("/", (c) => c.json({ ok: true }));

    n = 1;
    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/")).status).toBe(429);
    n = 2;
    expect((await app.request("/")).status).toBe(200);
  });

  it("perUserApiRateLimit keys by authenticated userId", async () => {
    const app = new Hono<{ Variables: { auth: { userId: string } } }>();
    app.onError(onError);
    // Stub auth from a header so each test request can vary the user.
    app.use("*", async (c, next) => {
      const userId = c.req.header("x-test-user") ?? "anon";
      c.set("auth", { userId });
      await next();
    });
    app.use("*", perUserApiRateLimit());
    app.get("/", (c) => c.json({ ok: true }));

    // Same user hammers the endpoint — gets blocked at 301.
    for (let i = 0; i < 300; i++) {
      const res = await app.request("/", {
        headers: { "x-test-user": "alice" },
      });
      expect(res.status, `request ${i + 1} for alice`).toBe(200);
    }
    const blocked = await app.request("/", {
      headers: { "x-test-user": "alice" },
    });
    expect(blocked.status).toBe(429);

    // A different user has its own bucket and is not affected.
    const ok = await app.request("/", { headers: { "x-test-user": "bob" } });
    expect(ok.status).toBe(200);
  });
});
