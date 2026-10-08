import { afterEach, describe, expect, it } from "vitest";
import { takeResetToken, takeSignInLinkToken } from "./auth.js";

const TOKEN = "ab".repeat(32);

afterEach(() => {
  history.replaceState(null, "", window.location.pathname);
});

describe("a mailed link's token in the address", () => {
  it("is taken once, by the link it belongs to, and removed", () => {
    window.location.hash = `#signin=${TOKEN}`;
    expect(takeResetToken()).toBeNull();
    expect(window.location.hash).toBe(`#signin=${TOKEN}`);
    expect(takeSignInLinkToken()).toBe(TOKEN);
    expect(window.location.hash).toBe("");
    expect(takeSignInLinkToken()).toBeNull();
  });

  it("still takes a reset link's", () => {
    window.location.hash = `#reset=${TOKEN}`;
    expect(takeSignInLinkToken()).toBeNull();
    expect(takeResetToken()).toBe(TOKEN);
    expect(window.location.hash).toBe("");
  });

  it("leaves anything that is not a token alone", () => {
    window.location.hash = "#signin=not-a-token";
    expect(takeSignInLinkToken()).toBeNull();
    expect(window.location.hash).toBe("#signin=not-a-token");
  });
});
