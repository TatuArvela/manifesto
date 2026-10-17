import { describe, expect, it } from "vitest";
import { linkPlatform, systemBrowserHref } from "./systemBrowser.ts";

describe("linkPlatform", () => {
  const nav = (userAgent: string, maxTouchPoints = 0) => ({
    userAgent,
    maxTouchPoints,
  });

  it("tells the phones apart from everything else", () => {
    expect(
      linkPlatform(nav("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129")),
    ).toBe("android");
    expect(
      linkPlatform(
        nav("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"),
      ),
    ).toBe("ios");
    expect(
      linkPlatform(nav("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129")),
    ).toBe("other");
  });

  it("takes a Mac with a touch screen for the iPad it is", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605";
    expect(linkPlatform(nav(mac, 5))).toBe("ios");
    expect(linkPlatform(nav(mac, 0))).toBe("other");
  });
});

describe("systemBrowserHref", () => {
  it("sends iOS to Safari through its own scheme", () => {
    expect(systemBrowserHref("https://example.com/a?b=1#c", "ios")).toBe(
      "x-safari-https://example.com/a?b=1#c",
    );
    expect(systemBrowserHref("http://example.com/", "ios")).toBe(
      "x-safari-http://example.com/",
    );
  });

  it("sends Android to the default browser, with the whole link to fall back to", () => {
    expect(systemBrowserHref("https://example.com/a?b=1#c", "android")).toBe(
      "intent://example.com/a?b=1#Intent;scheme=https;action=android.intent.action.VIEW;" +
        `S.browser_fallback_url=${encodeURIComponent("https://example.com/a?b=1#c")};end`,
    );
  });

  it("leaves alone a link that is not a web address, and other platforms", () => {
    expect(systemBrowserHref("mailto:someone@example.com", "ios")).toBeNull();
    expect(systemBrowserHref("javascript:alert(1)", "android")).toBeNull();
    expect(systemBrowserHref("not a url", "ios")).toBeNull();
    expect(systemBrowserHref("https://example.com/", "other")).toBeNull();
  });
});
