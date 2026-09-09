import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestLog } from "./requestLog.js";

function buildApp() {
  const app = new Hono();
  app.use("*", requestLog());
  app.get("/api/search", (c) => c.json({ notes: [] }));
  app.get("/api/auth/callback", (c) => c.json({ ok: true }));
  app.get("/api/boom", (c) => c.json({ error: "nope" }, 500));
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
    await buildApp().request("/api/search?q=my%20private%20note");

    expect(spy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spy.mock.calls[0][0] as string);
    expect(entry.path).toBe("/api/search");
    expect(spy.mock.calls[0][0]).not.toContain("private");
  });

  it("keeps an OIDC authorization code out of the log", async () => {
    const spy = captureLog();
    await buildApp().request("/api/auth/callback?code=super-secret&state=abc");

    const line = spy.mock.calls[0][0] as string;
    expect(line).not.toContain("super-secret");
    expect(line).not.toContain("state");
    expect(JSON.parse(line).path).toBe("/api/auth/callback");
  });

  it("records method, status and duration", async () => {
    const spy = captureLog();
    await buildApp().request("/api/boom");

    const entry = JSON.parse(spy.mock.calls[0][0] as string);
    expect(entry).toMatchObject({
      message: "request",
      method: "GET",
      path: "/api/boom",
      status: 500,
    });
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });
});
