import { describe, expect, test } from "vitest";
import { resolveServerOrigin } from "./config.js";

/**
 * A relative server base is right for `fetch` and useless to a WebSocket, so
 * the absolute form is derived once and the callers that cannot be relative
 * take that. Getting this wrong is what left a same-origin deployment with a
 * login screen and no sockets behind it.
 */
describe("resolveServerOrigin", () => {
  test("passes an absolute server through untouched", () => {
    expect(resolveServerOrigin("https://notes.example.com")).toBe(
      "https://notes.example.com",
    );
    expect(resolveServerOrigin("http://localhost:3001")).toBe(
      "http://localhost:3001",
    );
  });

  test("resolves a relative server against this page", () => {
    // `/` trims to the empty string before it gets here.
    expect(resolveServerOrigin("")).toBe(window.location.origin);
    expect(resolveServerOrigin("/notes")).toBe(
      `${window.location.origin}/notes`,
    );
  });

  test("has no origin to give in open mode", () => {
    expect(resolveServerOrigin(null)).toBeNull();
  });

  test("yields a ws(s) origin that matches the page's scheme", () => {
    // The transform the sockets apply. http pages get ws, https get wss, and
    // a same-origin deployment inherits whichever the page was served over.
    const ws = (url: string | null) =>
      resolveServerOrigin(url)?.replace(/^http/, "ws") ?? null;
    expect(ws("https://notes.example.com")).toBe("wss://notes.example.com");
    expect(ws("http://localhost:3001")).toBe("ws://localhost:3001");
    expect(ws("")).toBe(window.location.origin.replace(/^http/, "ws"));
  });
});
