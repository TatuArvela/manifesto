import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { onError } from "./error.js";
import { ipBucketKey, perUserApiRateLimit, rateLimit } from "./rateLimit.js";

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

    // Same user hammers the endpoint and gets blocked at 301.
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

describe("ipBucketKey", () => {
  it("keys an IPv6 client on its /64, however the address is written", () => {
    expect(ipBucketKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipBucketKey("2001:0db8:0000:0000:aaaa:bbbb:cccc:dddd")).toBe(
      "2001:db8:0:0::/64",
    );
    expect(ipBucketKey("2001:db8:0:0:0:0:0:0")).toBe("2001:db8:0:0::/64");
  });

  it("keeps separate /64s apart", () => {
    expect(ipBucketKey("2001:db8:0:1::1")).not.toBe(
      ipBucketKey("2001:db8:0:2::1"),
    );
  });

  it("ignores a zone index, which names a route and not a network", () => {
    expect(ipBucketKey("fe80::1%eth0")).toBe(ipBucketKey("fe80::2"));
  });

  it("keys an IPv4 client whole, mapped or not", () => {
    // Slicing four hextets off the mapped form would file every IPv4 client
    // on the internet into one bucket.
    expect(ipBucketKey("203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucketKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucketKey("::ffff:203.0.113.8")).toBe("203.0.113.8");
    // The same address written as hex groups, which is how some stacks
    // report it.
    expect(ipBucketKey("::ffff:c000:280")).toBe("192.0.2.128");
  });

  it("keys anything that is not an address as itself", () => {
    expect(ipBucketKey("anon")).toBe("anon");
    expect(ipBucketKey("unknown")).toBe("unknown");
    // Two "::", too few groups, and a group that is not hex.
    expect(ipBucketKey("2001:db8::1::2")).toBe("2001:db8::1::2");
    expect(ipBucketKey("2001:db8:1:2:3:4:5")).toBe("2001:db8:1:2:3:4:5");
    expect(ipBucketKey("2001:db8::zzzz")).toBe("2001:db8::zzzz");
  });
});

describe("rateLimit keyed by address", () => {
  function proxiedApp(limit: number) {
    const app = new Hono();
    app.onError(onError);
    app.use("*", rateLimit({ limit, windowMs: 1_000_000, trustProxy: true }));
    app.get("/", (c) => c.json({ ok: true }));
    return (ip: string) =>
      app.request("/", { headers: { "x-forwarded-for": ip } });
  }

  it("spends one budget on a whole IPv6 /64", async () => {
    const from = proxiedApp(1);
    expect((await from("2001:db8:1:2::1")).status).toBe(200);
    // A routed /64 is one subscriber, so rotating inside it buys nothing.
    expect((await from("2001:db8:1:2:ffff:ffff:ffff:ffff")).status).toBe(429);
    // The next /64 along is somebody else.
    expect((await from("2001:db8:1:3::1")).status).toBe(200);
  });

  it("gives each IPv4 client its own budget on a dual-stack listener", async () => {
    const from = proxiedApp(1);
    expect((await from("::ffff:203.0.113.7")).status).toBe(200);
    expect((await from("::ffff:203.0.113.8")).status).toBe(200);
    // Mapped and unmapped are the same client, and share the one bucket.
    expect((await from("203.0.113.7")).status).toBe(429);
  });
});
