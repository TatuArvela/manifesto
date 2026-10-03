import type { CapabilitiesResponse } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";
import { LoginScreen } from "./LoginScreen.js";

const LOCAL: CapabilitiesResponse["auth"] = {
  providers: ["local"],
  passwordForm: "shown",
  registration: true,
  passwordReset: false,
  magicLink: true,
  passkeys: false,
};
let auth = LOCAL;
let linkToken: string | null = null;
const requested: string[] = [];
const attempts: { token: string; otp: string | undefined }[] = [];
/** What the server makes of the link: fine, wanting a code, or spent. */
let account: "plain" | "twoFactor" | "expired" = "plain";

vi.mock("../state/auth.js", async (original) => {
  const actual = await original<typeof import("../state/auth.js")>();
  return {
    ...actual,
    fetchCapabilities: async () => ({ auth }),
    takeResetToken: () => null,
    takeSignInLinkToken: () => linkToken,
    requestSignInLink: async (email: string) => {
      requested.push(email);
      return true;
    },
    signInWithLink: async (token: string, otp?: string) => {
      attempts.push({ token, otp });
      if (account === "expired") throw new actual.AuthRequestError(410, "gone");
      if (account === "plain") return;
      if (otp === undefined) throw new actual.TwoFactorRequiredError("code");
      if (otp !== "123456") {
        throw new actual.AuthRequestError(401, "no", "two_factor_invalid");
      }
    },
  };
});

let host: HTMLDivElement;

const tick = () => new Promise((r) => requestAnimationFrame(r));

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label);

const shown = (text: string) =>
  vi.waitFor(() => expect(host.textContent).toContain(text));

describe("LoginScreen with sign-in by a mailed link", () => {
  beforeEach(() => {
    auth = LOCAL;
    linkToken = null;
    account = "plain";
    requested.length = 0;
    attempts.length = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    render(null, host);
    host.remove();
  });

  it("is not offered by a server that does not have it", async () => {
    auth = { ...LOCAL, magicLink: false };
    render(<LoginScreen />, host);
    await shown(t("login.submitSignIn"));
    expect(button(t("login.link.open"))).toBeUndefined();

    // Nor by one from before the feature, which says nothing of it.
    const { magicLink: _absent, ...older } = LOCAL;
    auth = older;
    render(null, host);
    render(<LoginScreen />, host);
    await shown(t("login.submitSignIn"));
    expect(button(t("login.link.open"))).toBeUndefined();
  });

  it("asks for a link by mail, and says the same whatever the address", async () => {
    render(<LoginScreen />, host);
    await vi.waitFor(() => expect(button(t("login.link.open"))).toBeDefined());
    button(t("login.link.open"))?.click();
    const email = await vi.waitFor(() => {
      const input = host.querySelector<HTMLInputElement>('input[type="email"]');
      expect(input).toBeTruthy();
      return input as HTMLInputElement;
    });
    type(email, " alice@example.com ");
    await tick();
    host.querySelector("form")?.requestSubmit();

    await shown(t("login.link.sent"));
    expect(requested).toEqual(["alice@example.com"]);
    button(t("login.back"))?.click();
    await shown(t("login.submitSignIn"));
  });

  it("signs in on arriving from a link, once", async () => {
    linkToken = "ab".repeat(32);
    render(<LoginScreen />, host);
    await vi.waitFor(() => expect(attempts).toHaveLength(1));
    expect(attempts[0]).toEqual({ token: linkToken, otp: undefined });
    await new Promise((r) => setTimeout(r, 50));
    expect(attempts).toHaveLength(1);
  });

  it("asks for the second factor with the same link", async () => {
    linkToken = "cd".repeat(32);
    account = "twoFactor";
    render(<LoginScreen />, host);
    await shown(t("login.twoFactor.title"));
    const code = host.querySelector("input") as HTMLInputElement;

    type(code, "000000");
    await tick();
    host.querySelector("form")?.requestSubmit();
    await shown(t("login.twoFactorInvalid"));

    type(code, "123456");
    await tick();
    host.querySelector("form")?.requestSubmit();
    await vi.waitFor(() => expect(attempts).toHaveLength(3));
    expect(attempts.map((a) => a.otp)).toEqual([undefined, "000000", "123456"]);
    expect(new Set(attempts.map((a) => a.token)).size).toBe(1);
  });

  it("says when the link is spent, and goes back to the form", async () => {
    linkToken = "ef".repeat(32);
    account = "expired";
    render(<LoginScreen />, host);
    await shown(t("login.link.expired"));
    button(t("login.back"))?.click();
    await shown(t("login.submitSignIn"));
  });
});
