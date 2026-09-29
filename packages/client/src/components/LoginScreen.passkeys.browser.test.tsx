import type {
  PasskeyAuthenticationResponse,
  PasskeyRequestOptions,
} from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";
import { LoginScreen } from "./LoginScreen.js";

const OPTIONS: PasskeyRequestOptions = {
  challenge: "Y2hhbGxlbmdl",
  rpId: "localhost",
  allowCredentials: [{ id: "Y3JlZA", type: "public-key" }],
};

const ANSWER: PasskeyAuthenticationResponse = {
  id: "Y3JlZA",
  rawId: "Y3JlZA",
  type: "public-key",
  response: {
    clientDataJSON: "e30",
    authenticatorData: "AA",
    signature: "AA",
  },
  clientExtensionResults: {},
};

const logins: { otp?: string; passkey?: PasskeyAuthenticationResponse }[] = [];
let passkeySignIns = 0;

vi.mock("../utils/webauthn.js", () => ({
  passkeysSupported: () => true,
  getPasskey: async () => ANSWER,
}));

vi.mock("../state/auth.js", async (original) => {
  const actual = await original<typeof import("../state/auth.js")>();
  return {
    ...actual,
    fetchCapabilities: async () => ({
      auth: {
        providers: ["local"],
        passwordForm: "shown",
        registration: true,
        passwordReset: false,
        passkeys: true,
      },
    }),
    login: async (
      _username: string,
      _password: string,
      _newPassword?: string,
      otp?: string,
      passkey?: PasskeyAuthenticationResponse,
    ) => {
      logins.push({ otp, passkey });
      if (otp === undefined && passkey === undefined) {
        // An account whose only second factor is a passkey.
        throw new actual.TwoFactorRequiredError(
          "second factor",
          false,
          OPTIONS,
        );
      }
    },
    signInWithPasskey: async () => {
      passkeySignIns += 1;
      return "unknown";
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

const button = (label: string) =>
  vi.waitFor(() => {
    const found = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(label),
    );
    expect(found).toBeTruthy();
    return found as HTMLButtonElement;
  });

describe("LoginScreen with passkeys", () => {
  beforeEach(() => {
    logins.length = 0;
    passkeySignIns = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    render(null, host);
    host.remove();
  });

  it("offers a passkey after the password, and a recovery code instead of an app's", async () => {
    render(<LoginScreen />, host);
    type(await field('input[autocomplete="username"]'), "alice");
    type(
      await field('input[autocomplete="current-password"]'),
      "password-1234",
    );
    await tick();
    host.querySelector("form")?.requestSubmit();

    (await button(t("login.twoFactor.usePasskey"))).click();
    expect(host.textContent).toContain(t("login.twoFactor.recoveryCode"));
    await vi.waitFor(() => expect(logins).toHaveLength(2));
    expect(logins[1]).toEqual({ otp: undefined, passkey: ANSWER });
  });

  it("signs in with a passkey alone, and says when it is not known", async () => {
    render(<LoginScreen />, host);
    (await button(t("login.withPasskey"))).click();
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("login.passkeyUnknown")),
    );
    expect(passkeySignIns).toBe(1);
  });
});
