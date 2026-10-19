import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defined } from "#/test/defined.ts";
import { requestLog } from "./requestLog.ts";

function buildApp() {
  const app = new Hono();
  app.use("*", requestLog());
  app.get("/api/v1/search", (c) => c.json({ notes: [] }));
  app.get("/api/v1/auth/callback", (c) => c.json({ ok: true }));
  app.get("/api/v1/boom", (c) => c.json({ error: "nope" }, 500));
  return app;
}

function captureLog() {
  return vi.spyOn(console, "log").mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestLog", () => {
  it("logs the path without the query string", async () => {
    const spy = captureLog();
    await buildApp().request("/api/v1/search?q=my%20private%20note");

    expect(spy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(defined(spy.mock.calls[0])[0] as string);
    expect(entry.path).toBe("/api/v1/search");
    expect(defined(spy.mock.calls[0])[0]).not.toContain("private");
  });

  it("keeps an OIDC authorization code out of the log", async () => {
    const spy = captureLog();
    await buildApp().request(
      "/api/v1/auth/callback?code=super-secret&state=abc",
    );

    const line = defined(spy.mock.calls[0])[0] as string;
    expect(line).not.toContain("super-secret");
    expect(line).not.toContain("state");
    expect(JSON.parse(line).path).toBe("/api/v1/auth/callback");
  });

  it("records method, status and duration", async () => {
    const spy = captureLog();
    await buildApp().request("/api/v1/boom");

    const entry = JSON.parse(defined(spy.mock.calls[0])[0] as string);
    expect(entry).toMatchObject({
      message: "request",
      method: "GET",
      path: "/api/v1/boom",
      status: 500,
    });
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });
});
