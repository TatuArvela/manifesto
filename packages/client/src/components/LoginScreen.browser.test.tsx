import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";
import { LoginScreen } from "./LoginScreen.js";

const calls: { password: string; otp?: string }[] = [];
let resetToken: string | null = null;
const resets: { token: string; password: string }[] = [];
const requested: string[] = [];
let methods: Record<string, unknown> = {
  provider: "local",
  userLookup: "search",
};

vi.mock("../state/auth.js", async (original) => {
  const actual = await original<typeof import("../state/auth.js")>();
  return {
    ...actual,
    fetchAuthMethods: async () => methods,
    takeResetToken: () => resetToken,
    requestPasswordReset: async (email: string) => {
      requested.push(email);
      return true;
    },
    confirmPasswordReset: async (token: string, password: string) => {
      resets.push({ token, password });
      return "ok";
    },
    login: async (
      _username: string,
      password: string,
      _newPassword?: string,
      otp?: string,
    ) => {
      calls.push({ password, otp });
      if (otp === undefined) throw new actual.TwoFactorRequiredError("code");
      if (otp !== "123 456") throw new actual.AuthRequestError(401, "no");
    },
  };
});

let host: HTMLDivElement;

const tick = () => new Promise((r) => requestAnimationFrame(r));

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const field = (selector: string) =>
  vi.waitFor(() => {
    const input = host.querySelector<HTMLInputElement>(selector);
    expect(input).toBeTruthy();
    return input as HTMLInputElement;
  });

describe("LoginScreen with two-factor sign-in", () => {
  beforeEach(() => {
    calls.length = 0;
    methods = { provider: "local", userLookup: "search" };
    resetToken = null;
    resets.length = 0;
    requested.length = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    render(null, host);
    host.remove();
  });

  it("asks for a code after the password, and says when it is wrong", async () => {
    render(<LoginScreen />, host);
    type(await field('input[autocomplete="username"]'), "alice");
    type(
      await field('input[autocomplete="current-password"]'),
      "password-1234",
    );
    await tick();
    host.querySelector("form")?.requestSubmit();

    const code = await field('input[autocomplete="one-time-code"]');
    expect(host.textContent).toContain(t("login.twoFactor.title"));
    type(code, "000000");
    await tick();
    host.querySelector("form")?.requestSubmit();
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("login.twoFactorInvalid")),
    );

    type(code, "123 456");
    await tick();
    host.querySelector("form")?.requestSubmit();
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls.at(-1)).toEqual({ password: "password-1234", otp: "123 456" });
  });

  it("offers single sign-on first and folds the password form away", async () => {
    methods = {
      provider: "oidc",
      providers: ["local", "oidc"],
      passwordForm: "collapsed",
      userLookup: "search",
    };
    render(<LoginScreen />, host);
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("login.oidcSubmit")),
    );
    expect(host.querySelector('input[autocomplete="username"]')).toBeNull();
    const reveal = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === t("login.withPassword"),
    );
    reveal?.click();
    await field('input[autocomplete="username"]');
  });

  it("asks for a reset link by mail when the server offers it", async () => {
    methods = { ...methods, passwordReset: true };
    render(<LoginScreen />, host);
    const link = await vi.waitFor(() => {
      const button = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === t("login.forgot.link"),
      );
      expect(button).toBeTruthy();
      return button as HTMLButtonElement;
    });
    link.click();
    type(await field('input[type="email"]'), "alice@example.com");
    await tick();
    host.querySelector("form")?.requestSubmit();
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("login.forgot.sent")),
    );
    expect(requested).toEqual(["alice@example.com"]);
  });

  it("sets a new password from a mailed link", async () => {
    resetToken = "abcdef0123456789";
    render(<LoginScreen />, host);
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("login.reset.title")),
    );
    const [next, confirm] = [
      ...host.querySelectorAll<HTMLInputElement>(
        'input[autocomplete="new-password"]',
      ),
    ];
    type(next, "brand-new-pass");
    type(confirm, "brand-new-pass");
    await tick();
    host.querySelector("form")?.requestSubmit();
    await vi.waitFor(() =>
      expect(resets).toEqual([
        { token: "abcdef0123456789", password: "brand-new-pass" },
      ]),
    );
    await field('input[autocomplete="current-password"]');
  });
});
