import { afterEach, describe, expect, it } from "vitest";
import {
  forgetConsentPage,
  rememberConsentPage,
  takeConsentPage,
} from "./oauth.js";

describe("coming back to the consent page after single sign-on", () => {
  const start = window.location.href;

  afterEach(() => {
    history.replaceState(null, "", start);
    sessionStorage.clear();
  });

  it("returns to the page it left, once", () => {
    history.replaceState(null, "", "/oauth/authorize?client_id=c&state=s");
    rememberConsentPage();
    history.replaceState(null, "", "/");
    expect(takeConsentPage()).toBe(
      `${window.location.origin}/oauth/authorize?client_id=c&state=s`,
    );
    expect(takeConsentPage()).toBeNull();
  });

  it("forgets it once the user has answered", () => {
    history.replaceState(null, "", "/oauth/authorize?client_id=c");
    rememberConsentPage();
    forgetConsentPage();
    expect(takeConsentPage()).toBeNull();
  });

  it("goes nowhere but this origin's consent page", () => {
    for (const href of [
      "https://elsewhere.example/oauth/authorize",
      `${window.location.origin}/trash`,
    ]) {
      sessionStorage.setItem(
        "manifesto:oauthConsent",
        JSON.stringify({ href, at: Date.now() }),
      );
      expect(takeConsentPage()).toBeNull();
    }
  });

  it("does not keep it for long", () => {
    sessionStorage.setItem(
      "manifesto:oauthConsent",
      JSON.stringify({
        href: `${window.location.origin}/oauth/authorize`,
        at: Date.now() - 60 * 60 * 1000,
      }),
    );
    expect(takeConsentPage()).toBeNull();
  });
});
