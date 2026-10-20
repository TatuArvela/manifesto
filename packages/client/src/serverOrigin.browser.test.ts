import { describe, expect, test } from "vitest";
import { resolveServerOrigin } from "./config.ts";

/**
 * A relative server base is correct for `fetch`, and of no use to a WebSocket.
 * Thus, the code derives the absolute form one time, and the callers that
 * cannot be relative take it. An error here left a same-origin deployment with
 * a login screen and no sockets behind it.
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
    // `/` becomes the empty string before it gets here.
    expect(resolveServerOrigin("")).toBe(window.location.origin);
    expect(resolveServerOrigin("/notes")).toBe(
      `${window.location.origin}/notes`,
    );
  });

  test("has no origin to give in open mode", () => {
    expect(resolveServerOrigin(null)).toBeNull();
  });

  test("yields a ws(s) origin that matches the page's scheme", () => {
    // The transform that the sockets apply. http pages get ws, and https pages
    // get wss. A same-origin deployment uses the protocol of the page.
    const ws = (url: string | null) =>
      resolveServerOrigin(url)?.replace(/^http/, "ws") ?? null;
    expect(ws("https://notes.example.com")).toBe("wss://notes.example.com");
    expect(ws("http://localhost:3001")).toBe("ws://localhost:3001");
    expect(ws("")).toBe(window.location.origin.replace(/^http/, "ws"));
  });
});
