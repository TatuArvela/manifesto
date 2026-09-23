import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";
import { LoginScreen } from "./LoginScreen.js";

const calls: { password: string; otp?: string }[] = [];

vi.mock("../state/auth.js", async (original) => {
  const actual = await original<typeof import("../state/auth.js")>();
  return {
    ...actual,
    fetchAuthMethods: async () => ({ provider: "local", userLookup: "search" }),
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
});
