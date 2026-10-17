import { describe, expect, it } from "vitest";
import { resolvePrivacyUrl } from "./privacyUrl.ts";

describe("resolvePrivacyUrl()", () => {
  it("is null when the deployment set none", () => {
    expect(resolvePrivacyUrl(null)).toBeNull();
  });

  it("takes a web address", () => {
    expect(resolvePrivacyUrl("https://example.com/privacy")).toBe(
      "https://example.com/privacy",
    );
    expect(resolvePrivacyUrl("http://intranet.example/privacy")).toBe(
      "http://intranet.example/privacy",
    );
  });

  it("takes a path on this site", () => {
    expect(resolvePrivacyUrl("/privacy.html")).toBe("/privacy.html");
  });

  it("refuses anything that is not a page to open", () => {
    expect(resolvePrivacyUrl("javascript:alert(1)")).toBeNull();
    expect(resolvePrivacyUrl("data:text/html,hi")).toBeNull();
    expect(resolvePrivacyUrl("//evil.example/privacy")).toBeNull();
    expect(resolvePrivacyUrl("privacy policy")).toBeNull();
  });
});
